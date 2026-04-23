/**
 * WebCodecs-based H.264 decoder pipeline used by `DeviceView`.
 *
 * The backend forwards raw scrcpy video packets verbatim. The first packet has
 * `isConfig: true` and contains SPS+PPS NAL units back-to-back in Annex-B; we
 * parse those to derive the codec string and the avcC `description` blob the
 * browser's `VideoDecoder.configure` requires. Subsequent packets carry coded
 * pictures which we re-frame from Annex-B into AVCC (start codes replaced with
 * 4-byte big-endian length prefixes) before passing to `decoder.decode`.
 */

export interface DecoderFramePayload {
  ptsUs: number;
  isConfig: boolean;
  isKey: boolean;
  data: Uint8Array;
}

export interface DecoderCallbacks {
  onFrame: (frame: VideoFrame) => void;
  onError: (err: Error) => void;
}

/**
 * Split an Annex-B bytestream into NAL units (payload only, start codes stripped).
 * Tolerates both 3-byte and 4-byte start codes.
 */
export function splitAnnexB(stream: Uint8Array): Uint8Array[] {
  const marks: Array<{ payloadStart: number; startCodeStart: number }> = [];
  let i = 0;
  while (i + 3 <= stream.length) {
    if (stream[i] === 0 && stream[i + 1] === 0) {
      if (
        i + 4 <= stream.length &&
        stream[i + 2] === 0 &&
        stream[i + 3] === 1
      ) {
        marks.push({ payloadStart: i + 4, startCodeStart: i });
        i += 4;
        continue;
      }
      if (stream[i + 2] === 1) {
        marks.push({ payloadStart: i + 3, startCodeStart: i });
        i += 3;
        continue;
      }
    }
    i += 1;
  }
  const out: Uint8Array[] = [];
  for (let m = 0; m < marks.length; m++) {
    const start = marks[m].payloadStart;
    const end = marks[m + 1]?.startCodeStart ?? stream.length;
    if (start < end) out.push(stream.subarray(start, end));
  }
  return out;
}

/**
 * Convert an Annex-B framed bytestream to AVCC framing (each NAL prefixed by a
 * 4-byte big-endian length). Required by WebCodecs when the decoder is
 * configured with an avcC description.
 */
export function annexBToAvcc(stream: Uint8Array): Uint8Array {
  const nals = splitAnnexB(stream);
  let total = 0;
  for (const n of nals) total += 4 + n.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const n of nals) {
    const len = n.length;
    out[off++] = (len >>> 24) & 0xff;
    out[off++] = (len >>> 16) & 0xff;
    out[off++] = (len >>> 8) & 0xff;
    out[off++] = len & 0xff;
    out.set(n, off);
    off += len;
  }
  return out;
}

function nalType(nal: Uint8Array): number {
  return nal.length > 0 ? nal[0] & 0x1f : 0;
}

interface AvccBuild {
  description: Uint8Array;
  codec: string;
}

/**
 * Build the avcC `description` blob and the `avc1.PPCCLL` codec string from the
 * SPS+PPS Annex-B configuration packet. Layout per ISO/IEC 14496-15 §5.2.4.1.
 */
export function buildAvcc(configAnnexB: Uint8Array): AvccBuild {
  const nals = splitAnnexB(configAnnexB);
  const sps = nals.find((n) => nalType(n) === 7);
  const pps = nals.find((n) => nalType(n) === 8);
  if (!sps || !pps) {
    throw new Error("config packet missing SPS or PPS NAL unit");
  }
  if (sps.length < 4) throw new Error("SPS too short");
  // sps[0] = NAL header, sps[1..4] = profile_idc, profile_compatibility, level_idc
  const profile = sps[1];
  const compat = sps[2];
  const level = sps[3];
  const hex = (b: number) => b.toString(16).padStart(2, "0");
  const codec = `avc1.${hex(profile)}${hex(compat)}${hex(level)}`;

  const buf = new Uint8Array(11 + sps.length + pps.length);
  let o = 0;
  buf[o++] = 0x01; // configurationVersion
  buf[o++] = profile;
  buf[o++] = compat;
  buf[o++] = level;
  buf[o++] = 0xff; // 6 reserved bits set + lengthSizeMinusOne = 3
  buf[o++] = 0xe1; // 3 reserved bits set + numOfSequenceParameterSets = 1
  buf[o++] = (sps.length >>> 8) & 0xff;
  buf[o++] = sps.length & 0xff;
  buf.set(sps, o);
  o += sps.length;
  buf[o++] = 0x01; // numOfPictureParameterSets
  buf[o++] = (pps.length >>> 8) & 0xff;
  buf[o++] = pps.length & 0xff;
  buf.set(pps, o);

  return { description: buf, codec };
}

// Cap on the decoder's internal queue. When the consumer (canvas paint) can't
// keep up, delta frames pile up in WebKit's internal buffer and balloon
// memory — drop deltas above this threshold but always accept key frames so
// we don't desync.
const MAX_DECODE_QUEUE = 4;

export class H264Decoder {
  private decoder: VideoDecoder;
  private configured = false;
  private closed = false;

  constructor(private readonly callbacks: DecoderCallbacks) {
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.closed) {
          frame.close();
          return;
        }
        this.callbacks.onFrame(frame);
      },
      error: (e) => this.callbacks.onError(e),
    });
  }

  feed(payload: DecoderFramePayload): void {
    if (this.closed) return;
    try {
      if (payload.isConfig) {
        const { description, codec } = buildAvcc(payload.data);
        this.decoder.configure({
          codec,
          optimizeForLatency: true,
          description,
        });
        this.configured = true;
        return;
      }
      if (!this.configured) {
        // Drop pictures that arrive before the first config packet.
        return;
      }
      // Backpressure: drop delta frames when the decode queue is too deep.
      // Always let keyframes through to keep the stream resyncable.
      if (!payload.isKey && this.decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
        return;
      }
      const avcc = annexBToAvcc(payload.data);
      const chunk = new EncodedVideoChunk({
        type: payload.isKey ? "key" : "delta",
        timestamp: payload.ptsUs,
        data: avcc,
      });
      this.decoder.decode(chunk);
    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.decoder.state !== "closed") {
      try {
        this.decoder.close();
      } catch {
        // ignore double-close
      }
    }
  }
}
