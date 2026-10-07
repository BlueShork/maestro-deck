// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! A read-only view of the git repo open in the app, for plugins granted
//! `permissions.workspace`. The status is computed by hashing the work tree
//! against HEAD's tree, the way git does without its index cache, so no `git`
//! binary is needed on the QA's machine.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use sha1::{Digest, Sha1};

pub const MAX_CHANGES: usize = 2000;
pub const READ_CAP: u64 = 25 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GithubRepo {
    pub owner: String,
    pub repo: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub head: Option<String>,
    pub github: Option<GithubRepo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WorkspaceInfo {
    pub name: String,
    pub git: Option<GitInfo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Change {
    pub path: String,
    pub status: Status,
    pub size: u64,
    pub executable: bool,
}

fn internal(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn parse_github_remote(url: &str) -> Option<GithubRepo> {
    let url = url.trim();
    let rest = if let Some(r) = url.strip_prefix("https://") {
        let (host, path) = r.split_once('/')?;
        if host.rsplit('@').next()? != "github.com" {
            return None;
        }
        path
    } else {
        url.strip_prefix("git@github.com:")
            .or_else(|| url.strip_prefix("ssh://git@github.com/"))?
    };
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    let ok = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    };
    (parts.next().is_none() && ok(owner) && ok(repo)).then(|| GithubRepo {
        owner: owner.into(),
        repo: repo.into(),
    })
}

pub fn blob_oid(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    hex::encode(h.finalize())
}

/// CRLF → LF for text files when the repo converts line endings on commit.
fn clean(bytes: Vec<u8>, autocrlf: bool) -> Vec<u8> {
    let head = &bytes[..bytes.len().min(8000)];
    if !autocrlf || head.contains(&0) || !bytes.windows(2).any(|w| w == b"\r\n") {
        return bytes;
    }
    let mut out = Vec::with_capacity(bytes.len());
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
            continue;
        }
        out.push(b);
    }
    out
}

struct Repo {
    repo: gix::Repository,
    workdir: PathBuf,
    autocrlf: bool,
}

fn open(root: &Path) -> Result<Repo, String> {
    let repo = gix::discover(root)
        .map_err(|_| "bad_request: this folder is not a git repository".to_string())?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "bad_request: this repository has no work tree".to_string())?
        .canonicalize()
        .map_err(internal)?;
    let autocrlf = repo
        .config_snapshot()
        .string("core.autocrlf")
        .map(|v| {
            matches!(
                v.to_string().to_ascii_lowercase().as_str(),
                "true" | "input"
            )
        })
        .unwrap_or(false);
    Ok(Repo {
        repo,
        workdir,
        autocrlf,
    })
}

/// `a/b` from `<workdir>/a/b`, `/`-separated whatever the OS.
fn repo_rel(workdir: &Path, abs: &Path) -> Result<String, String> {
    let rel = abs
        .strip_prefix(workdir)
        .map_err(|_| "forbidden: path is outside the repository".to_string())?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| match c {
            Component::Normal(s) => Ok(s.to_string_lossy().into_owned()),
            _ => Err("bad_request: unexpected path component".to_string()),
        })
        .collect::<Result<_, _>>()?;
    Ok(parts.join("/"))
}

/// HEAD's blobs: path → (oid, executable). Empty on an unborn branch.
fn head_blobs(repo: &gix::Repository) -> Result<HashMap<String, (String, bool)>, String> {
    let Ok(commit) = repo.head_commit() else {
        return Ok(HashMap::new());
    };
    let tree = commit.tree().map_err(internal)?;
    let mut rec = gix::traverse::tree::Recorder::default();
    tree.traverse().breadthfirst(&mut rec).map_err(internal)?;
    Ok(rec
        .records
        .into_iter()
        .filter_map(|r| {
            use gix::object::tree::EntryKind;
            let exec = match r.mode.kind() {
                EntryKind::Blob => false,
                EntryKind::BlobExecutable => true,
                _ => return None, // trees, symlinks, submodules
            };
            Some((r.filepath.to_string(), (r.oid.to_string(), exec)))
        })
        .collect())
}

fn file_oid(path: &Path, autocrlf: bool) -> Result<String, String> {
    Ok(blob_oid(&clean(
        fs::read(path).map_err(internal)?,
        autocrlf,
    )))
}

/// (size, mtime seconds, mtime nanoseconds) as git last saw a file.
type CachedStat = (u32, u32, u32);

/// Stat data from the index for entries that still equal HEAD. A file whose
/// size and mtime match is unchanged without being read, as in `git status`.
/// Entries modified at or after the index was written are left out: their
/// stat cannot vouch for their content ("racy git").
fn clean_stats(
    repo: &gix::Repository,
    head: &HashMap<String, (String, bool)>,
) -> HashMap<String, CachedStat> {
    let Ok(index) = repo.index_or_empty() else {
        return HashMap::new();
    };
    let written = gix::index::entry::stat::Time::from(index.timestamp());
    index
        .entries()
        .iter()
        .filter_map(|e| {
            let path = e.path(&index).to_string();
            let (oid, _) = head.get(&path)?;
            let m = e.stat.mtime;
            let in_head = gix::ObjectId::from_hex(oid.as_bytes()).ok()?;
            if e.id != in_head || (m.secs, m.nsecs) >= (written.secs, written.nsecs) {
                return None;
            }
            Some((path, (e.stat.size, m.secs, m.nsecs)))
        })
        .collect()
}

fn stat_matches(meta: &fs::Metadata, cached: Option<&CachedStat>) -> bool {
    let (Some(&(size, secs, nsecs)), Ok(modified)) = (cached, meta.modified()) else {
        return false;
    };
    let Ok(t) = modified.duration_since(std::time::UNIX_EPOCH) else {
        return false;
    };
    meta.len() as u32 == size && t.as_secs() as u32 == secs && t.subsec_nanos() == nsecs
}

#[cfg(unix)]
fn is_exec(meta: &fs::Metadata, _head: bool) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}
#[cfg(not(unix))]
fn is_exec(_meta: &fs::Metadata, head: bool) -> bool {
    head
}

pub fn info(root: &Path) -> Result<Option<WorkspaceInfo>, String> {
    if !root.is_dir() {
        return Ok(None);
    }
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let git = match gix::discover(root) {
        Err(_) => None,
        Ok(repo) => {
            let head = repo.head().map_err(internal)?;
            let branch = head.referent_name().map(|n| n.shorten().to_string());
            let head_id = head.id().map(|id| id.to_string());
            let github = repo
                .find_remote("origin")
                .ok()
                .and_then(|r| {
                    r.url(gix::remote::Direction::Fetch)
                        .map(|u| u.to_bstring().to_string())
                })
                .and_then(|u| parse_github_remote(&u));
            Some(GitInfo {
                branch,
                head: head_id,
                github,
            })
        }
    };
    Ok(Some(WorkspaceInfo { name, git }))
}

/// A repo-relative, `/`-separated path that cannot leave the work tree. Unlike
/// a plugin's own file paths, `:` is allowed where the OS allows it in names.
fn safe_repo_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && (!cfg!(windows) || !p.contains(':'))
        && p.split('/')
            .all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

fn push(out: &mut Vec<Change>, c: Change) -> Result<(), String> {
    out.push(c);
    if out.len() > MAX_CHANGES {
        return Err(format!("too_large: over {MAX_CHANGES} changed files"));
    }
    Ok(())
}

pub fn changes(root: &Path) -> Result<Vec<Change>, String> {
    let Repo {
        repo,
        workdir,
        autocrlf,
    } = open(root)?;
    let root = root.canonicalize().map_err(internal)?;
    let prefix = match repo_rel(&workdir, &root)? {
        p if p.is_empty() => String::new(),
        p => format!("{p}/"),
    };
    let head = head_blobs(&repo)?;
    let stats = clean_stats(&repo, &head);
    let differs =
        |path: &str, abs: &Path, meta: &fs::Metadata, oid: &str| -> Result<bool, String> {
            if stat_matches(meta, stats.get(path)) {
                return Ok(false);
            }
            Ok(file_oid(abs, autocrlf)? != oid)
        };
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    let walker = ignore::WalkBuilder::new(&root)
        .hidden(false)
        .parents(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|e| {
            let is_dir = e.file_type().is_some_and(|t| t.is_dir());
            e.file_name() != ".git" && !(is_dir && e.depth() > 0 && e.path().join(".git").exists())
        })
        .build();
    for entry in walker {
        let entry = entry.map_err(internal)?;
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue; // dirs and symlinks
        }
        let path = repo_rel(&workdir, entry.path())?;
        let meta = entry.metadata().map_err(internal)?;
        let in_head = head.get(&path);
        let status = match in_head {
            None => Some(Status::Added),
            Some((oid, _)) if differs(&path, entry.path(), &meta, oid)? => Some(Status::Modified),
            Some(_) => None,
        };
        if let Some(status) = status {
            let executable = is_exec(&meta, in_head.is_some_and(|h| h.1));
            push(
                &mut out,
                Change {
                    path: path.clone(),
                    status,
                    size: meta.len(),
                    executable,
                },
            )?;
        }
        seen.insert(path);
    }

    for (path, (oid, exec)) in &head {
        if !path.starts_with(&prefix) || seen.contains(path) {
            continue;
        }
        let abs = workdir.join(path);
        match fs::symlink_metadata(&abs) {
            Ok(m) if m.is_file() => {
                // Tracked but now ignored: the walk skipped it, git still tracks it.
                if differs(path, &abs, &m, oid)? {
                    push(
                        &mut out,
                        Change {
                            path: path.clone(),
                            status: Status::Modified,
                            size: m.len(),
                            executable: is_exec(&m, *exec),
                        },
                    )?;
                }
            }
            Ok(_) => {} // became a directory or a symlink
            Err(_) => push(
                &mut out,
                Change {
                    path: path.clone(),
                    status: Status::Deleted,
                    size: 0,
                    executable: *exec,
                },
            )?,
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn read_file(root: &Path, path: &str, allowed: &HashSet<String>) -> Result<Vec<u8>, String> {
    if !safe_repo_path(path) {
        return Err(format!("bad_request: invalid path {path:?}"));
    }
    if !allowed.contains(path) || path.split('/').any(|c| c == ".git") {
        return Err(format!(
            "forbidden: {path} is not a changed file of this workspace"
        ));
    }
    let Repo {
        workdir, autocrlf, ..
    } = open(root)?;
    let abs = workdir.join(path);
    let meta =
        fs::symlink_metadata(&abs).map_err(|_| format!("bad_request: {path} no longer exists"))?;
    let inside = abs
        .canonicalize()
        .map(|c| c.starts_with(&workdir))
        .unwrap_or(false);
    if !meta.is_file() || !inside {
        return Err(format!(
            "forbidden: {path} is not a regular file inside the repository"
        ));
    }
    if meta.len() > READ_CAP {
        return Err(format!("too_large: {path} is over 25 MB"));
    }
    Ok(clean(fs::read(&abs).map_err(internal)?, autocrlf))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args([
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "-c",
                "commit.gpgsign=false",
            ])
            .args(args)
            .current_dir(dir)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    /// A repo with one commit: flows/a.yaml, shots/b.png, .gitignore (ignores *.log).
    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        git(p, &["init", "-q", "-b", "main"]);
        std::fs::create_dir_all(p.join("flows")).unwrap();
        std::fs::create_dir_all(p.join("shots")).unwrap();
        std::fs::write(p.join("flows/a.yaml"), "appId: x\n").unwrap();
        std::fs::write(p.join("shots/b.png"), [0u8, 1, 2, 3]).unwrap();
        std::fs::write(p.join(".gitignore"), "*.log\n").unwrap();
        git(p, &["add", "-A"]);
        git(p, &["commit", "-qm", "init"]);
        git(
            p,
            &["remote", "add", "origin", "git@github.com:acme/app.git"],
        );
        d
    }

    fn summary(c: &[Change]) -> Vec<(String, Status)> {
        c.iter().map(|c| (c.path.clone(), c.status)).collect()
    }

    #[test]
    fn parses_github_remotes() {
        let r = |owner: &str, repo: &str| {
            Some(GithubRepo {
                owner: owner.into(),
                repo: repo.into(),
            })
        };
        assert_eq!(
            parse_github_remote("https://github.com/acme/app.git"),
            r("acme", "app")
        );
        assert_eq!(
            parse_github_remote("https://github.com/acme/app"),
            r("acme", "app")
        );
        assert_eq!(
            parse_github_remote("https://me@github.com/acme/app.git"),
            r("acme", "app")
        );
        assert_eq!(
            parse_github_remote("git@github.com:acme/app.git"),
            r("acme", "app")
        );
        assert_eq!(
            parse_github_remote("ssh://git@github.com/acme/my.app.git"),
            r("acme", "my.app")
        );
        assert_eq!(parse_github_remote("https://gitlab.com/acme/app.git"), None);
        assert_eq!(parse_github_remote("https://github.com/acme"), None);
        assert_eq!(
            parse_github_remote("https://github.com/acme/app/extra"),
            None
        );
    }

    #[test]
    fn blob_oid_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(
            blob_oid(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn info_reports_branch_head_and_github() {
        let d = repo();
        let i = info(d.path()).unwrap().unwrap();
        let g = i.git.unwrap();
        assert_eq!(g.branch.as_deref(), Some("main"));
        assert_eq!(g.head.as_ref().map(|h| h.len()), Some(40));
        assert_eq!(
            g.github,
            Some(GithubRepo {
                owner: "acme".into(),
                repo: "app".into()
            })
        );
    }

    #[test]
    fn info_without_git_or_folder() {
        let d = tempfile::tempdir().unwrap();
        let plain = d.path().join("plain");
        std::fs::create_dir(&plain).unwrap();
        assert_eq!(info(&plain).unwrap().unwrap().git, None);
        assert_eq!(info(&d.path().join("missing")).unwrap(), None);
    }

    #[test]
    fn info_on_unborn_branch() {
        let d = tempfile::tempdir().unwrap();
        git(d.path(), &["init", "-q", "-b", "main"]);
        let g = info(d.path()).unwrap().unwrap().git.unwrap();
        assert_eq!((g.branch.as_deref(), g.head), (Some("main"), None));
    }

    #[test]
    fn changes_lists_added_modified_deleted_and_respects_gitignore() {
        let d = repo();
        let p = d.path();
        std::fs::write(p.join("flows/a.yaml"), "appId: y\n").unwrap(); // modified, unstaged
        std::fs::write(p.join("flows/new.yaml"), "x").unwrap(); // untracked
        std::fs::write(p.join("shots/c.png"), [9u8]).unwrap();
        git(p, &["add", "shots/c.png"]); // added, staged
        std::fs::remove_file(p.join("shots/b.png")).unwrap(); // deleted
        std::fs::write(p.join("debug.log"), "x").unwrap(); // ignored
        std::fs::create_dir_all(p.join(".maestro")).unwrap();
        std::fs::write(p.join(".maestro/config.yaml"), "x").unwrap(); // dotfolder, untracked
        let c = changes(p).unwrap();
        assert_eq!(
            summary(&c),
            vec![
                (".maestro/config.yaml".into(), Status::Added),
                ("flows/a.yaml".into(), Status::Modified),
                ("flows/new.yaml".into(), Status::Added),
                ("shots/b.png".into(), Status::Deleted),
                ("shots/c.png".into(), Status::Added),
            ]
        );
        assert_eq!(c[2].size, 1);
    }

    #[test]
    fn unchanged_tree_has_no_changes() {
        let d = repo();
        assert!(changes(d.path()).unwrap().is_empty());
    }

    #[test]
    fn subfolder_root_lists_only_its_files_with_repo_paths() {
        let d = repo();
        let p = d.path();
        std::fs::write(p.join("flows/a.yaml"), "appId: z\n").unwrap();
        std::fs::remove_file(p.join("shots/b.png")).unwrap(); // outside the root
        assert_eq!(
            summary(&changes(&p.join("flows")).unwrap()),
            vec![("flows/a.yaml".into(), Status::Modified)]
        );
    }

    #[test]
    fn tracked_file_that_is_now_ignored_is_still_compared() {
        let d = repo();
        let p = d.path();
        std::fs::write(p.join(".gitignore"), "*.log\nshots/\n").unwrap();
        git(p, &["commit", "-qam", "ignore shots"]);
        std::fs::write(p.join("shots/b.png"), [7u8]).unwrap();
        assert_eq!(
            summary(&changes(p).unwrap()),
            vec![("shots/b.png".into(), Status::Modified)]
        );
    }

    #[test]
    fn nested_repos_are_skipped() {
        let d = repo();
        let nested = d.path().join("vendor/lib");
        std::fs::create_dir_all(&nested).unwrap();
        git(&nested, &["init", "-q"]);
        std::fs::write(nested.join("x.txt"), "x").unwrap();
        assert!(changes(d.path()).unwrap().is_empty());
    }

    #[test]
    fn crlf_is_normalised_when_autocrlf_is_set() {
        let d = repo();
        let p = d.path();
        git(p, &["config", "core.autocrlf", "true"]);
        std::fs::write(p.join("flows/a.yaml"), "appId: x\r\n").unwrap();
        assert!(changes(p).unwrap().is_empty());
        let allowed = HashSet::from(["flows/a.yaml".to_string()]);
        assert_eq!(
            read_file(p, "flows/a.yaml", &allowed).unwrap(),
            b"appId: x\n"
        );
    }

    #[test]
    fn too_many_changes_fail_fast() {
        let d = repo();
        let dir = d.path().join("many");
        std::fs::create_dir(&dir).unwrap();
        for i in 0..=MAX_CHANGES {
            std::fs::write(dir.join(format!("{i}.txt")), "x").unwrap();
        }
        assert!(changes(d.path()).unwrap_err().starts_with("too_large:"));
    }

    /// Files whose stat still matches the index entry, and whose entry equals
    /// HEAD, are trusted without being read, the way git does it.
    #[cfg(unix)]
    #[test]
    fn unchanged_files_with_matching_index_stat_are_not_read() {
        use std::os::unix::fs::PermissionsExt;
        let d = repo();
        let p = d.path();
        let f = p.join("shots/b.png");
        // Age the file so the index is written after it (not racy), then
        // refresh the index's stat data.
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(past)
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        git(p, &["update-index", "--refresh"]);
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o000)).unwrap();
        let listed = changes(p);
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(listed.unwrap(), vec![]);
    }

    #[test]
    fn changes_outside_a_repo_is_bad_request() {
        let d = tempfile::tempdir().unwrap();
        assert!(changes(d.path()).unwrap_err().starts_with("bad_request:"));
    }

    #[test]
    fn read_file_only_reads_allowed_regular_files() {
        let d = repo();
        let p = d.path();
        std::fs::write(p.join("flows/a.yaml"), "new").unwrap();
        let allowed = HashSet::from([
            "flows/a.yaml".to_string(),
            ".git/config".to_string(),
            "../x".to_string(),
        ]);
        assert_eq!(read_file(p, "flows/a.yaml", &allowed).unwrap(), b"new");
        assert!(read_file(p, "shots/b.png", &allowed)
            .unwrap_err()
            .starts_with("forbidden:"));
        assert!(read_file(p, ".git/config", &allowed)
            .unwrap_err()
            .starts_with("forbidden:"));
        assert!(read_file(p, "../x", &allowed)
            .unwrap_err()
            .starts_with("bad_request:"));
    }

    /// Legal on macOS and Linux, and common in screenshot names.
    #[cfg(unix)]
    #[test]
    fn listed_files_with_a_colon_in_the_name_can_be_read() {
        let d = repo();
        let p = d.path();
        std::fs::write(p.join("shots/at 12:30.png"), [5u8]).unwrap();
        let listed = changes(p).unwrap();
        assert_eq!(
            summary(&listed),
            vec![("shots/at 12:30.png".into(), Status::Added)]
        );
        let allowed = HashSet::from(["shots/at 12:30.png".to_string()]);
        assert_eq!(
            read_file(p, "shots/at 12:30.png", &allowed).unwrap(),
            vec![5u8]
        );
    }

    #[cfg(unix)]
    #[test]
    fn read_file_refuses_symlinks() {
        let d = repo();
        let p = d.path();
        std::os::unix::fs::symlink("/etc/hosts", p.join("flows/link.yaml")).unwrap();
        let allowed = HashSet::from(["flows/link.yaml".to_string()]);
        assert!(read_file(p, "flows/link.yaml", &allowed)
            .unwrap_err()
            .starts_with("forbidden:"));
        assert!(changes(p).unwrap().is_empty(), "symlinks are not listed");
    }

    #[test]
    fn read_file_caps_size() {
        let d = repo();
        let p = d.path();
        let f = std::fs::File::create(p.join("big.bin")).unwrap();
        f.set_len(READ_CAP + 1).unwrap();
        let allowed = HashSet::from(["big.bin".to_string()]);
        assert!(read_file(p, "big.bin", &allowed)
            .unwrap_err()
            .starts_with("too_large:"));
    }
}
