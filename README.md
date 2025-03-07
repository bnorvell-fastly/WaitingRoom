# Javascript Waiting Room

Waiting room application for your endpoints. This uses Fastly Compute, with the Key Value store, and Secret store being used
to store configurations, and keys/tokens respectively.

Redis is uses to store the Waiting Room state, and this leverages the upstash.io SDK to connect to an HTTPS based redis instance.

See global_config.json for an example of the global configuration object (key globalConfig)
See queue_config.json for an example of the per queue configuration object (path, and key /sample-queue)

RSA public and private keys are in PEM format, and must be written to the config store properly or misc. errors will be thrown.
TODO : provide example cmdline for openssl to create keys that can be used.

Redis connection is using an API token, not a user/password. Store this token in the secret store as well.

## Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
