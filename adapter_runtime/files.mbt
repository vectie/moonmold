///|
pub(all) struct AdapterRuntimeIssue {
  code : String
  path : String
  message : String
} derive(Debug, Eq, ToJson, FromJson)

///|
fn issue(code : String, path : String, message : String) -> AdapterRuntimeIssue {
  { code, path, message }
}

///|
fn valid_identity(value : String) -> Bool {
  !value.trim().is_empty() &&
  !value.contains("/") &&
  !value.contains("\\") &&
  !value.contains("\u0000") &&
  value != "." &&
  value != ".."
}

///|
fn valid_relative_ref(value : String) -> Bool {
  let normalized = value.trim().replace(old="\\", new="/")
  !normalized.is_empty() &&
  !normalized.has_prefix("/") &&
  !normalized.contains("\u0000") &&
  !normalized.contains("://") &&
  !normalized
  .split("/")
  .any(segment => segment == "" || segment == "." || segment == "..")
}

///|
fn trim_trailing_slash(path : String) -> String {
  let mut output = path
  while output.length() > 1 && output.has_suffix("/") {
    output = output[:output.length() - 1].to_owned()
  }
  output
}

///|
fn resolve_ref(
  workspace_root : String,
  artifact_ref : String,
) -> Result[String, AdapterRuntimeIssue] {
  if !workspace_root.has_prefix("/") || workspace_root == "/" {
    return Err(
      issue(
        "invalid-workspace-root", workspace_root, "MoonMold requires a non-root absolute workspace",
      ),
    )
  }
  if !valid_relative_ref(artifact_ref) {
    return Err(
      issue(
        "unsafe-artifact-ref", artifact_ref, "artifact references must be workspace-relative without traversal or URL syntax",
      ),
    )
  }
  Ok(trim_trailing_slash(workspace_root) + "/" + artifact_ref)
}

///|
fn output_ref(
  workspace_root : String,
  value : String,
) -> Result[(String, String), AdapterRuntimeIssue] {
  let root = trim_trailing_slash(workspace_root)
  if value.has_prefix(root + "/") {
    let relative = value[root.length() + 1:].to_owned()
    return match resolve_ref(root, relative) {
      Ok(path) => Ok((relative, path))
      Err(error) => Err(error)
    }
  }
  match resolve_ref(root, value) {
    Ok(path) => Ok((value, path))
    Err(error) => Err(error)
  }
}

///|
fn ensure_dir(path : String) -> Result[Unit, AdapterRuntimeIssue] {
  if @fsx.path_exists(path) {
    return Ok(())
  }
  @fsx.create_dir(path) catch {
    _ =>
      return Err(
        issue(
          "create-directory", path, "failed to create MoonMold adapter directory",
        ),
      )
  }
  Ok(())
}

///|
fn ensure_directory_tree(path : String) -> Result[Unit, AdapterRuntimeIssue] {
  let absolute = path.has_prefix("/")
  let mut current = if absolute { "" } else { "." }
  for component in path.split("/") {
    if component == "" || component == "." {
      continue
    }
    let owned = component.to_owned()
    current = if current == "" || current == "/" {
      "/" + owned
    } else {
      current + "/" + owned
    }
    match ensure_dir(current) {
      Ok(_) => ()
      Err(error) => return Err(error)
    }
  }
  Ok(())
}

///|
fn parent_dir(path : String) -> String {
  match path.rev_find("/") {
    Some(index) if index > 0 => path[:index].to_owned()
    _ => "."
  }
}

///|
fn write_text(
  path : String,
  text : String,
) -> Result[Unit, AdapterRuntimeIssue] {
  match ensure_directory_tree(parent_dir(path)) {
    Ok(_) => ()
    Err(error) => return Err(error)
  }
  @fsx.write_string_to_file(path, text) catch {
    _ =>
      return Err(
        issue(
          "write-adapter-evidence", path, "failed to persist MoonMold adapter evidence",
        ),
      )
  }
  Ok(())
}

///|
fn write_json(path : String, value : Json) -> Result[Unit, AdapterRuntimeIssue] {
  write_text(path, value.stringify(indent=2) + "\n")
}

///|
fn read_json(path : String) -> Result[Json, AdapterRuntimeIssue] {
  let text = @fsx.read_file_to_string(path) catch {
    _ =>
      return Err(
        issue(
          "read-adapter-evidence", path, "failed to read MoonMold adapter evidence",
        ),
      )
  }
  Ok(
    @json.parse(text) catch {
      _ =>
        return Err(
          issue(
            "parse-adapter-evidence", path, "failed to parse MoonMold adapter evidence",
          ),
        )
    },
  )
}

///|
fn[T : @json.FromJson] read_typed(
  path : String,
) -> Result[T, AdapterRuntimeIssue] {
  let value = match read_json(path) {
    Ok(value) => value
    Err(error) => return Err(error)
  }
  Ok(
    @json.from_json(value) catch {
      _ =>
        return Err(
          issue(
            "decode-adapter-evidence", path, "failed to decode MoonMold adapter evidence",
          ),
        )
    },
  )
}

///|
fn sha256_text(text : String) -> String {
  "sha256:" + @crypto.bytes_to_hex_string(@crypto.sha256(@utf8.encode(text)))
}

///|
fn sha256_bytes(bytes : Bytes) -> String {
  "sha256:" + @crypto.bytes_to_hex_string(@crypto.sha256(bytes))
}

///|
fn attempt_root_ref(attempt_id : String) -> String {
  ".moonsuite/products/moonmold/adapter-attempts/\{attempt_id}"
}

///|
fn request_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/request.json"
}

///|
fn input_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/input.json"
}

///|
fn attempt_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/attempt.json"
}

///|
fn receipt_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/operation-receipt.json"
}

///|
fn result_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/adapter-result.json"
}

///|
fn reconciliation_ref(attempt_id : String) -> String {
  attempt_root_ref(attempt_id) + "/reconciliation.json"
}

///|
fn journal_ref() -> String {
  ".moonsuite/products/moonmold/runtime/semantic-journal.json"
}
