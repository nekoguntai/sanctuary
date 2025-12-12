"use strict";
(() => {
  // content/injected.ts
  var messageId = 0;
  var pendingRequests = /* @__PURE__ */ new Map();
  var deviceChangeListeners = /* @__PURE__ */ new Set();
  var REQUEST_TIMEOUT = 3e4;
  function sendMessage(type, payload, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      const timeoutHandle = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Request timed out"));
      }, timeout);
      pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });
      window.postMessage({
        type: `SANCTUARY_HW_${type}`,
        id,
        payload
      }, "*");
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const { type, id, success, data, error, devices } = event.data;
    if (type === "SANCTUARY_HW_DEVICE_UPDATE" && devices) {
      for (const listener of deviceChangeListeners) {
        try {
          listener(devices);
        } catch (e) {
          console.error("Device change listener error:", e);
        }
      }
      return;
    }
    if (type?.endsWith("_RESPONSE") && id !== void 0) {
      const pending = pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(id);
        if (success) {
          pending.resolve(data);
        } else {
          pending.reject(new Error(error || "Unknown error"));
        }
      }
    }
  });
  var sanctuaryHWBridge = {
    isAvailable: true,
    version: "1.0.0",
    async getDevices() {
      return sendMessage("GET_DEVICES");
    },
    async getXpub(path, deviceId) {
      return sendMessage("GET_XPUB", { path, deviceId });
    },
    async signPSBT(psbt, inputPaths, deviceId) {
      return sendMessage(
        "SIGN_PSBT",
        { psbt, inputPaths, deviceId },
        6e4
      );
    },
    async verifyAddress(path, address, deviceId) {
      return sendMessage("VERIFY_ADDRESS", { path, address, deviceId });
    },
    async connectDevice(deviceType) {
      return sendMessage("CONNECT_DEVICE", { deviceType });
    },
    onDeviceChange(callback) {
      deviceChangeListeners.add(callback);
      return () => deviceChangeListeners.delete(callback);
    }
  };
  window.sanctuaryHWBridge = sanctuaryHWBridge;
  window.dispatchEvent(new CustomEvent("sanctuaryHWBridgeReady", {
    detail: { version: "1.0.0" }
  }));
  console.log("Sanctuary HW Bridge API injected");
})();
