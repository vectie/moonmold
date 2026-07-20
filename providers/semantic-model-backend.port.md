# Semantic model backend port

A provider accepts only the declared semantic operation algebra and returns an
idempotent receipt bound to request, parent digest, output digests, adapter
identity/version, evidence class, and claim ceiling. Provider implementations
must expose capability discovery and reconciliation. An unavailable Blender
provider fails explicitly; it cannot silently substitute mock evidence.
