# Javascript Waiting Room

Waiting room application for your endpoints. This uses Fastly Compute, with the Key Value store, and Secret store being used
to store configurations, and keys/tokens respectively.

## KV Store - 'queueconfig'

+ key : globalConfig - The master configuration for the queuing system, see example for all values. All of these configuration settings
                       can be overriden on a queue by queue basis.
### The following keys refer to other keys in the various key value stores :
- redisToken - Key in the Secure Store, which contains your redis API token
- publicKey  - Key in the Secure Store, which contains your Public Key, in JWKS format
- privateKey - Key in the Secure Store, which contains your Private Key, in JWKS format
- queuePage  - Key in the KV Store 'queueconfig' which is shown to users by default when the queue is active.
- adminPage  - deprecated.
                           

Redis is used to store the Waiting Room state, and this leverages the upstash.io SDK to connect to an HTTPS based redis instance.

See global_config.json for an example of the global configuration object (key globalConfig)
See queue_config.json for an example of the per queue configuration object (path, and key /sample-queue)

RSA public and private keys are in JSWK format, and must be written to the config store properly or misc. errors will be thrown.

#### TODO
- Example cmdline/process for creating JWKS keys
- move sample confiugurations to directory supported by the toml file for local testing
- Explain the redis key schema

## Security issues

Please see our [SECURITY.md](SECURITY.md) for guidance on reporting security-related issues.
