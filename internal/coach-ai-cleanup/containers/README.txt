Cleanup container inputs — prepared October 16, 2026; NOT BUILT OR DEPLOYED

Dockerfile.console and Dockerfile.observer pin every stage to the same official
Node 22 Debian bookworm-slim Linux amd64 manifest digest. base-image.json records
the verified index/platform/configuration digests. Only public registry metadata
was fetched; no image layers were pulled and no base container was executed.

contexts.manifest.json identifies the two isolated raw-source contexts under the
protected local preparation directory. Use only those contexts for a separately
approved future build, never the mobile workspace root. They contain 30 console
files and 19 observer files, including their exact recipe and deny-by-default
.dockerignore. Every copied file has an origin, byte count and SHA-256. Directory
exceptions re-exclude descendants before admitting exact filenames, so unknown
children are not implicitly admitted. Context inventory must match the manifest
again immediately before any future build; stop on drift, do not restage silently.

dependencies.manifest.json retains the existing Functions package/lock hashes,
exact root SDK/compiler versions and all 264 locked vendor entries with registry
URLs and integrity values. No lock was regenerated, dependency upgraded or package
installed. Platform/optional entries describe the lock, not an installed image.
Console runtime vendors use npm ci --omit=dev --ignore-scripts; unused vendor
packages may remain as reviewed. Observer runtime has no project npm dependencies.
Both future compile stages use the reviewed SDK/compiler lock for type declarations;
observer-sdk-types.d.ts supplies declarations only and emits no runtime module.

The recipes install/compile only during a LATER authorized build. Each npm install
disables lifecycle scripts, audit/funding/update checks and automatic fetch retries.
Compilation uses TypeScript 5.9.3, no source maps, and noEmitOnError. The console's
seven source modules are type checked, and exactly six compiled modules are copied
to its final image. The observer copies one pure compiled module. Both require all
twelve shared CJS startup modules because the bootstrap statically imports them.
Explicit COPY lists omit the Functions index, unrelated Functions, tests, native
files, credentials, private config, operator UID pins, source maps and raw sources
from the final image. The console also copies its six public static assets.

Final application files are read-only and the service runs as UID/GID 1000 with
port 8080. Both recipes keep login, reads, mutations and observation OFF. The
console has its documented planned deterministic HTTPS origin; verify the assigned
service URI after an authorized deployment. No credential/UID/secret build argument
or environment binding is included. Future credentials remain runtime-only.

Local acceptance completed once: nine static integrity/recipe/context checks and
two TypeScript no-emit configurations using the existing pinned toolchain, zero
diagnostics. No older app suites, Docker checks, image builds, installs, emitted
JavaScript, cloud changes or store submissions ran. Docker/build/runtime behavior
and actual installed vendor inventory remain unverified until separately approved.

Current result: docs/coach-ai-cleanup-container-preparation-20261016.txt/.json.
Future sequence: read-only repository/deployer/service-agent access reconciliation;
exact scoped provisioning and build approval; approved image build/acceptance with
digest capture; separate private disabled deployment approval. No action here
authorizes grants, public invocation, roster writes, capabilities, schedules or mail.
