openssl genrsa -out rsa.pem 2048
openssl rsa -in rsa.pem -pubout -out jwt_pub.pem
eckles jwt_pub.pem > pubkey.jwk
#openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in jwtRS256.pem -out jwtRS256_private.pkcs8
