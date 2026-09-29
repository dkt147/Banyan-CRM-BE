export function validate(schema, source = "body") {
  return (req, _res, next) => {
    req[source] = schema.parse(req[source]);
    next();
  };
}
