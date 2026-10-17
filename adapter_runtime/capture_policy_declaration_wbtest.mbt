///|
test "static and native owner declarations retain identical capture policies" {
  let retained = @json.parse(
    @fsx.read_file_to_string("adapters/moonmold-pack-local-v1.declaration.json"),
  )
  assert_eq(retained, @suite_adapter.adapter_declaration_json())
}
