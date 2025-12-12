"use strict";
(() => {
  // content/bridge.ts
  function injectScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("content/injected.js");
    script.onload = function() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }
  async function sendToBackground(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type, payload },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error || "Unknown error"));
          }
        }
      );
    });
  }
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const { type, id, payload } = event.data;
    if (!type?.startsWith("SANCTUARY_HW_")) return;
    try {
      let result;
      switch (type) {
        case "SANCTUARY_HW_GET_DEVICES":
          result = await sendToBackground("GET_DEVICES");
          break;
        case "SANCTUARY_HW_CONNECT_DEVICE":
          result = await sendToBackground("CONNECT_DEVICE", payload);
          break;
        case "SANCTUARY_HW_DISCONNECT_DEVICE":
          result = await sendToBackground("DISCONNECT_DEVICE", payload);
          break;
        case "SANCTUARY_HW_GET_XPUB":
          result = await sendToBackground("GET_XPUB", payload);
          break;
        case "SANCTUARY_HW_SIGN_PSBT":
          result = await sendToBackground("SIGN_PSBT", payload);
          break;
        case "SANCTUARY_HW_VERIFY_ADDRESS":
          result = await sendToBackground("VERIFY_ADDRESS", payload);
          break;
        case "SANCTUARY_HW_GET_STATUS":
          result = await sendToBackground("GET_STATUS");
          break;
        default:
          throw new Error(`Unknown message type: ${type}`);
      }
      window.postMessage({
        type: `${type}_RESPONSE`,
        id,
        success: true,
        data: result
      }, "*");
    } catch (error) {
      window.postMessage({
        type: `${type}_RESPONSE`,
        id,
        success: false,
        error: error.message || "Unknown error"
      }, "*");
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DEVICE_UPDATE") {
      window.postMessage({
        type: "SANCTUARY_HW_DEVICE_UPDATE",
        devices: message.devices
      }, "*");
    }
  });
  injectScript();
  window.postMessage({
    type: "SANCTUARY_HW_READY",
    version: "1.0.0"
  }, "*");
  console.log("Sanctuary HW Bridge content script loaded");
})();
