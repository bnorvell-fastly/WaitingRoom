import { Logger } from "fastly:logger";
import { env } from "fastly:env";

export default function log(
  endpointName,
  req,
  client,
  permitted,
  responseStatus,
  queueData
) {
  return;
  
  const endpoint = new Logger(endpointName);
  endpoint.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      clientAddress: client.address,
      requestUrl: req.url.toString(),
      requestMethod: req.method,
      requestReferer: req.headers.get("Referer"),
      requestUserAgent: req.headers.get("User-Agent"),
      fastlyRegion: env.get("FASTLY_REGION"),
      fastlyServiceId: env.get("FASTLY_SERVICE_ID"),
      fastlyServiceVersion: env.get("FASTLY_SERVICE_VERSION"),
      fastlyHostname: env.get("FASTLY_HOSTNAME"),
      fastlyTraceId: env.get("FASTLY_TRACE_ID"),
      ...tryGeo(client),
      responseStatus,
      permitted,
      ...queueData,
    })
  );
}

// Geolocation is not supported by the local testing server,
// so we just return an empty object if it fails.
function tryGeo(client) {
  try {
    return {
      clientGeoCountry: client.geo.country_code,
      clientGeoCity: client.geo.city,
    };
  } catch (e) {
    return {};
  }
}