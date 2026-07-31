///|
fn usage() -> String {
  (
    #|MoonMold MoonFlow adapter
    #|
    #|  capability
    #|  declaration
    #|  health <workspace-root> <checked-at> <valid-until>
    #|  source-bundle <pack.json> <workspace-root> <compiled-at> <valid-until>
    #|  invoke <workspace-root> <request.json>
    #|  reconcile <workspace-root> <request.json>
    #|  reconcile-report <workspace-root> <request.json>
    #|
  )
}

///|
fn arg(args : Array[String], index : Int) -> String? {
  args.get(index)
}

///|
fn command_index(args : Array[String]) -> Int {
  match args.get(0) {
    Some(
      "capability"
      | "declaration"
      | "health"
      | "source-bundle"
      | "invoke"
      | "reconcile"
      | "reconcile-report"
      | "help"
    ) => 0
    _ => 1
  }
}

///|
fn print_issue(issue : @adapter_runtime.AdapterRuntimeIssue) -> Unit {
  println(
    ({ "contract_id": "moonmold.adapter-cli-error.v1", "error": issue } : Json).stringify(
      indent=2,
    ),
  )
}

///|
fn load_request(
  path : String,
) -> Result[
  @suite_adapter.MoonflowAdapterRequest,
  @adapter_runtime.AdapterRuntimeIssue,
] {
  let text = @fsx.read_file_to_string(path) catch {
    _ =>
      return Err({
        code: "read-adapter-request",
        path,
        message: "failed to read MoonFlow adapter request JSON",
      })
  }
  let value = @json.parse(text) catch {
    _ =>
      return Err({
        code: "parse-adapter-request",
        path,
        message: "failed to parse MoonFlow adapter request JSON",
      })
  }
  try @suite_adapter.decode_moonflow_adapter_request(value) catch {
    error =>
      Err({
        code: "decode-adapter-request",
        path,
        message: "failed to decode MoonFlow adapter request: \{error}",
      })
  } noraise {
    request => Ok(request)
  }
}

///|
fn fail_issue(
  issue : @adapter_runtime.AdapterRuntimeIssue,
  exit_code : Int,
) -> Unit {
  print_issue(issue)
  @sys.exit(exit_code)
}

///|
fn main {
  let args = @sys.get_cli_args()
  let index = command_index(args)
  let command = arg(args, index).unwrap_or("capability")
  match command {
    "capability" =>
      println(
        @suite_adapter.moonflow_adapter_capability_json().stringify(indent=2),
      )
    "declaration" =>
      println(@suite_adapter.adapter_declaration_json().stringify(indent=2))
    "invoke" | "reconcile" | "reconcile-report" =>
      match (arg(args, index + 1), arg(args, index + 2)) {
        (Some(workspace), Some(request_path)) =>
          match load_request(request_path) {
            Err(error) => fail_issue(error, 2)
            Ok(request) =>
              if command == "invoke" {
                match @adapter_runtime.invoke(workspace, request) {
                  Ok(result) => println(result.to_json().stringify(indent=2))
                  Err(error) => fail_issue(error, 3)
                }
              } else {
                match @adapter_runtime.reconcile(workspace, request) {
                  Ok(report) =>
                    if command == "reconcile" {
                      println(report.result.to_json().stringify(indent=2))
                    } else {
                      println(report.to_json().stringify(indent=2))
                    }
                  Err(error) => fail_issue(error, 3)
                }
              }
          }
        _ => {
          println(usage())
          @sys.exit(2)
        }
      }
    "health" =>
      match (arg(args, index + 1), arg(args, index + 2), arg(args, index + 3)) {
        (Some(workspace), Some(checked_at), Some(valid_until)) =>
          match
            @adapter_runtime.health_attestation(
              workspace, checked_at, valid_until,
            ) {
            Ok(health) => println(health.to_json().stringify(indent=2))
            Err(error) => fail_issue(error, 3)
          }
        _ => {
          println(usage())
          @sys.exit(2)
        }
      }
    "source-bundle" =>
      match
        (
          arg(args, index + 1),
          arg(args, index + 2),
          arg(args, index + 3),
          arg(args, index + 4),
        ) {
        (Some(pack_path), Some(workspace), Some(compiled_at), Some(valid_until)) => {
          let pack_text = @fsx.read_file_to_string(pack_path) catch {
            _ => {
              fail_issue(
                {
                  code: "read-pack-manifest",
                  path: pack_path,
                  message: "failed to read MoonMold pack manifest",
                },
                2,
              )
              ""
            }
          }
          let pack = @json.parse(pack_text) catch {
            _ => {
              fail_issue(
                {
                  code: "parse-pack-manifest",
                  path: pack_path,
                  message: "failed to parse MoonMold pack manifest",
                },
                2,
              )
              Json::empty_object()
            }
          }
          match
            @adapter_runtime.capability_source_bundle(
              pack, workspace, compiled_at, valid_until,
            ) {
            Ok(bundle) => println(bundle.stringify(indent=2))
            Err(error) => fail_issue(error, 3)
          }
        }
        _ => {
          println(usage())
          @sys.exit(2)
        }
      }
    _ => println(usage())
  }
}
