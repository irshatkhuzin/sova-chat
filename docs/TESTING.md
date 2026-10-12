# Testing

Run from the repository root with Node.js 22+:

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run check:publication
```

Build first: server regression tests import compiled modules.
The default suite uses synthetic data and mocked dependencies. It does not need
MySQL, Redis, credentials, a running deployment, or paid AI access.

Coverage includes read queues, inbox ordering, panel reconnection, widget session
restoration, generic knowledge retrieval, support decisions, and empty initial
configuration. The publication guard checks common secret signatures, private
file paths, English documentation, and local Markdown links. It is not a complete
security audit.

For live behavior, provision a disposable installation, create your own test
administrator/product/channel/articles, and follow [CHECKLIST.md](CHECKLIST.md).
Real model calls may incur provider charges. Never use production customer data
as fixtures or include private screenshots in reports.

## Android

With JDK 17/21, Gradle 8.7, and Android SDK 34:

```sh
gradle -p android-sdk :sova-sdk:testDebugUnitTest :sova-sdk:assembleRelease :demo-app:assembleDebug
```

The repository has no Gradle wrapper. Tests use JUnit, MockWebServer, and
Robolectric with synthetic responses. Android builds are separate from Node CI.
Use a filesystem path compatible with your Android tooling.