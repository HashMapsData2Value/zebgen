# [1.7.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.6.0...v1.7.0) (2026-10-19)


### Bug Fixes

* **security:** enforce swap timing floors and dedicated key shares ([be7bd3f](https://github.com/HashMapsData2Value/zebgen/commit/be7bd3fa25a2eae37842465e056b463d20a740d4))


### Features

* **wallet:** add encrypted portable swap backups ([f3273e6](https://github.com/HashMapsData2Value/zebgen/commit/f3273e69d424ac4047461c321afc9f12be471043))

# [1.6.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.5.1...v1.6.0) (2026-10-19)


### Features

* **site:** add browser logos and latest release download links ([bcc22de](https://github.com/HashMapsData2Value/zebgen/commit/bcc22de583c9eb44f99d1f02a22582027f2b7a6d))

## [1.5.1](https://github.com/HashMapsData2Value/zebgen/compare/v1.5.0...v1.5.1) (2026-10-19)


### Bug Fixes

* **release:** name browser archives with version and browser ([981d23c](https://github.com/HashMapsData2Value/zebgen/commit/981d23ca5f5db7c5a2c19df9280c1af98695504c))

# [1.5.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.4.0...v1.5.0) (2026-10-19)


### Features

* **security:** execute agreement settlements entirely inside Zebgen ([4f7c2a9](https://github.com/HashMapsData2Value/zebgen/commit/4f7c2a9ae2714e5c2980cad05a45fd82bf5cecaa))
* **wallet:** support multiple Algorand mnemonics and active address inventories ([5baee91](https://github.com/HashMapsData2Value/zebgen/commit/5baee918fa9f472ea5ebef4dd3478df132cc11da))

# [1.4.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.3.0...v1.4.0) (2026-10-18)


### Bug Fixes

* **deps:** consume leakswap-utils through npm without sibling checkout ([b2681b7](https://github.com/HashMapsData2Value/zebgen/commit/b2681b7710d47f8ce0e8b57d831a5e3187710b18))
* **site:** deploy generated assets with Workers ([e4775e0](https://github.com/HashMapsData2Value/zebgen/commit/e4775e0cb72a5d021ab546b9a3dc7d4c11a0186a))
* **site:** serve dedicated cache-busted brand favicons ([fcbb1c3](https://github.com/HashMapsData2Value/zebgen/commit/fcbb1c3330e44802790914da23fd2614207b3b0d))


### Features

* **monero:** add stoppable scans, live progress and reliable worker connections ([10cbbfc](https://github.com/HashMapsData2Value/zebgen/commit/10cbbfcabd9f8cdb8485b08dc32e67757de6c64c))
* **provider:** approve agreement-bound swaps and decode signing intent ([e278588](https://github.com/HashMapsData2Value/zebgen/commit/e278588556cd7f2c5dc29b6f7f2b52875e21c0d8))
* **site:** add zebgen landing page and branded assets ([035e269](https://github.com/HashMapsData2Value/zebgen/commit/035e2692d8ebc11442704adadcd4a08971ac6a3b))
* **swap:** bind persisted agreements to verified deployments and funding ([972f1f3](https://github.com/HashMapsData2Value/zebgen/commit/972f1f31cb701e04da3980d0a379c58d92f5d929))
* **swap:** read live contract status and role-specific deadlines ([be53f5d](https://github.com/HashMapsData2Value/zebgen/commit/be53f5dd99a1a9b0deece8e8a06164a7a2c0fac3))
* **swap:** sign and persist authenticated wallet handshakes ([2bb27d9](https://github.com/HashMapsData2Value/zebgen/commit/2bb27d992f2c8f38567bd2fb5931a77312a8805d))
* **transactions:** require fresh PIN approval and read confirmation receipts ([b72a070](https://github.com/HashMapsData2Value/zebgen/commit/b72a07044a0fd622b47a17e6911349962327ec9c))
* **ui:** unify wallet setup and focus navigation on active swaps ([ac803f2](https://github.com/HashMapsData2Value/zebgen/commit/ac803f28f97c42d441467559921962c4c0548b0d))
* **wallet:** persist swap recovery and deposits with explicit account approval ([7de34ac](https://github.com/HashMapsData2Value/zebgen/commit/7de34acbbc3f9610c5f630af6fc81cbdb1e016b4))
* **wallet:** validate combined-wallet recovery material ([11ab5bf](https://github.com/HashMapsData2Value/zebgen/commit/11ab5bf8211f00097f0455b60f4261569efc887a))
* **wallet:** validate receiving addresses and selected chain identity ([2c83e32](https://github.com/HashMapsData2Value/zebgen/commit/2c83e32fdb7eaeb9210e31a0d5390095c741ff15))

# [1.3.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.2.0...v1.3.0) (2026-10-15)


### Features

* **wallet:** prepare transactions and preserve swap recovery context ([afd755a](https://github.com/HashMapsData2Value/zebgen/commit/afd755ab1a74fb879d60bbec902f1a01b4a3ea22))

# [1.2.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.1.0...v1.2.0) (2026-10-13)


### Features

* **monero:** automatic restore heights and send entire balance ([901db5b](https://github.com/HashMapsData2Value/zebgen/commit/901db5b76e21d11d5f0647b03dab079c75ccb7ff))

# [1.1.0](https://github.com/HashMapsData2Value/zebgen/compare/v1.0.0...v1.1.0) (2026-10-13)


### Features

* **monero:** send XMR with zebgen-monero-wasm (monero-oxide) instead of monero-ts ([a67cf0c](https://github.com/HashMapsData2Value/zebgen/commit/a67cf0ce98d61eb182699d958fa4006644dac574))

# 1.0.0 (2026-10-12)


### Bug Fixes

* **ci:** convert env flow-mapping to block style to fix YAML parse error ([e202a45](https://github.com/HashMapsData2Value/zebgen/commit/e202a45b3c0358020f93b423674d326d75c3b6d6))


### Features

* add semantic-release pipeline with GitHub Release zip assets ([7bd305c](https://github.com/HashMapsData2Value/zebgen/commit/7bd305cb36a6d42ccb6087bab9a1cd8bf939a9e6))
* first commit ([73a3b17](https://github.com/HashMapsData2Value/zebgen/commit/73a3b17d794dd17b9f3a2de5ccaa68fbd5759ab1))
