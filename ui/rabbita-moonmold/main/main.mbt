///|
#warnings("-alert_unstable")
fn main {
  let (emit, cell) = @rabbita.cell_with_emit(
    model=initial_model(),
    update~,
    view~,
  )
  @rabbita.new(cell)
  ..with_init(status_request(emit))
  .mount("app")
}
