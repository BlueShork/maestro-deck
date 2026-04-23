import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FlowEditor } from "@/components/FlowEditor";
import { InspectorPanel } from "@/components/InspectorPanel";
import { RunConsole } from "@/components/RunConsole";
import { Toolbar } from "@/components/Toolbar";

export default function App() {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border">
          <DeviceSelector />
          <div className="min-h-0 flex-1 overflow-auto">
            <InspectorPanel />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <section className="flex min-w-0 flex-1 items-center justify-center bg-black/40 p-4">
              <DeviceView />
            </section>
            <section className="flex w-[45%] min-w-0 flex-col border-l border-border">
              <FlowEditor />
            </section>
          </div>
          <RunConsole />
        </main>
      </div>
    </div>
  );
}
