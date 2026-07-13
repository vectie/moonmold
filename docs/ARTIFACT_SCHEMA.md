# Spatial Artifact and Lineage Schema

MoonMold distinguishes five durable outputs:

| Representation | Intended consumer | Claim ceiling |
|---|---|---|
| Editable source | MoonMold/MoonDesk | Reproducible digital authoring state |
| Engineering | MoonRobo | Digital engineering candidate |
| Presentation | MoonTown/browser | Presentation only |
| Simulation | MoonMoon | Simulation-input candidate |
| Manufacturing candidate | Later fabrication review | Analysis only; no machine authority |

The portable manifest proposal maps directly to MoonLib:

- `artifactId`
- `representationClass`
- `digest`
- `parentDigest`
- `lineageRelation`
- `transformId` and transform parameters
- `units`
- `coordinateFrame`
- `knownLosses`
- `assumptions`
- validation evidence identities
- producer/tool version
- authority envelope
- claim ceiling

Style transfer is represented by a presentation sibling with
`styled-from`; it cannot mutate or overwrite the engineering object. Simulation
and manufacturing candidates likewise name the engineering digest as their
parent and declare losses.

Canonical JSON sorts object keys recursively before SHA-256. MoonBit's `mm1`
key is a deterministic non-cryptographic integrity key for lightweight local
manifests; serialized cross-product artifacts should use SHA-256.

Paths in receipts are logical `moonsuite://` URIs. Runtime resolution accepts
only descendants of the declared root under `/Users/kq/moonsuite`; traversal,
foreign roots, symbolic-link ancestors, immutable output collisions, and NUL
bytes fail closed.

## Portable ingestion envelope

Each engineering, presentation, and simulation export also writes
`<representation>.portable.json`. The envelope contains a
`moonmold.spatial-artifact.v1` manifest and its
`moonmold.representation-transform.v1` transform using MoonLib's portable
snake-case field names. Consumers therefore parse serialized contracts rather
than importing MoonMold source code.

The transform child identity/digest must equal the manifest identity/digest.
Presentation and simulation transforms must name the engineering artifact and
digest as parent. Every manifest includes authority envelope, procedure,
assumptions, unresolved gaps, intended/forbidden consumers, validation refs,
claim ceiling, units, coordinate system, up axis, handedness, and canonical
recording time.
