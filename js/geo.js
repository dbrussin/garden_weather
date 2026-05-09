// Browser geolocation wrapper.

/**
 * Request the user's current position.
 * @param {PositionOptions} [options]
 * @returns {Promise<{ lat: number, lon: number, accuracy: number }>}
 */
function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => reject(translateError(err)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000, ...options },
    );
  });
}

function translateError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return new Error("Location permission denied.");
    case err.POSITION_UNAVAILABLE:
      return new Error("Could not determine your location.");
    case err.TIMEOUT:
      return new Error("Location request timed out.");
    default:
      return new Error("Location error.");
  }
}

window.getCurrentPosition = getCurrentPosition;
