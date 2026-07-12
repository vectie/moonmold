# Architecture

MoonMold's core is a backend-neutral MoonBit package. Public concrete types are
owned by the root package so callers can construct and inspect them without
depending on an implementation package.

The adapter boundary accepts only semantic operations: create model, create
bounded primitives, set transforms, assign materials, boolean subtract,
validate, and export a declared representation. Each request includes project,
session, model, request and idempotency identities; expected parent digest;
workspace root; deadline; authority; and typed operation.

The mock backend is the reference state machine. It proves stale-parent
rejection, identical duplicate no-op, conflicting duplicate rejection,
deterministic scene lineage, scoped paths, and authority ceilings without
requiring Blender. The external adapter runtime maps the same operations to a
backend. Blender is optional and capability-discovered; absence cannot weaken
the core behavior.

## Portable field proposal

Cross-product spatial manifests should carry:

- artifact identity and representation class;
- content/manifest digest and immutable parent digest;
- lineage relation and transform identity;
- units and coordinate frame;
- known losses and assumptions;
- validation evidence identities and acceptance state;
- producing tool/version, authority envelope, and claim ceiling.

MoonTown receives presentation siblings. MoonRobo receives engineering and
collision representations. MoonMoon receives simulation representations.
MoonBook owns reference provenance and reflections. No sibling-source import is
required: interchange is serialized portable data.

