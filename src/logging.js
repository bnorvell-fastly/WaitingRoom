import { Logger } from "fastly:logger";
import { env } from "fastly:env";
import { DEBUG } from './index.js'; // In case we switch to using a global log function to log debug and operational logs

export default function log(
  endpointName,
  req,
  client,
  permitted,
  responseStatus,
  queueData
) {
  
  const endpoint = new Logger(endpointName);
  endpoint.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      clientAddress: client.address,
      requestUrl: req.url.toString(),
      requestMethod: req.method,
      requestReferer: req.headers.get("Referer"),
      requestUserAgent: req.headers.get("User-Agent"),
      fastlyRegion: env("FASTLY_REGION"),
      fastlyServiceId: env("FASTLY_SERVICE_ID"),
      fastlyServiceVersion: env("FASTLY_SERVICE_VERSION"),
      fastlyHostname: env("FASTLY_HOSTNAME"),
      fastlyTraceId: env("FASTLY_TRACE_ID"),
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
      clientGeoCountry: client.geo.country_code3,
      clientGeoCity: client.geo.city,
    };
  } catch (e) {
    return {};
  }
}