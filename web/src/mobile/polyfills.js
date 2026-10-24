// The few browser globals the engine expects that JavaScriptCore doesn't have.
(function (g) {
  if (typeof g.window === "undefined") g.window = g;
  if (typeof g.self === "undefined") g.self = g;
  if (typeof g.navigator === "undefined") g.navigator = { userAgent: "JavaScriptCore", language: "en" };
  if (typeof g.document === "undefined") g.document = undefined;
  if (typeof g.setTimeout === "undefined") g.setTimeout = function (f) { f(); return 0; };
  if (typeof g.TextEncoder === "undefined") {
    g.TextEncoder = function () {};
    g.TextEncoder.prototype.encode = function (s) {
      var u = unescape(encodeURIComponent(String(s))), out = new Uint8Array(u.length);
      for (var i = 0; i < u.length; i++) out[i] = u.charCodeAt(i);
      return out;
    };
  }
  if (typeof g.TextDecoder === "undefined") {
    g.TextDecoder = function () {};
    g.TextDecoder.prototype.decode = function (b) {
      var a = b instanceof Uint8Array ? b : new Uint8Array(b || []), s = "";
      for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
      try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    };
  }
  var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  if (typeof g.btoa === "undefined") {
    g.btoa = function (s) {
      var out = "";
      for (var i = 0; i < s.length; i += 3) {
        var a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
        var n = (a << 16) | ((b || 0) << 8) | (c || 0);
        out += abc[(n >> 18) & 63] + abc[(n >> 12) & 63] + (isNaN(b) ? "=" : abc[(n >> 6) & 63]) + (isNaN(c) ? "=" : abc[n & 63]);
      }
      return out;
    };
  }
  if (typeof g.atob === "undefined") {
    g.atob = function (s) {
      s = String(s).replace(/[^A-Za-z0-9+/]/g, "");
      var out = "";
      for (var i = 0; i < s.length; i += 4) {
        var n = (abc.indexOf(s[i]) << 18) | (abc.indexOf(s[i + 1]) << 12) | ((abc.indexOf(s[i + 2]) & 63) << 6) | (abc.indexOf(s[i + 3]) & 63);
        out += String.fromCharCode((n >> 16) & 255);
        if (s[i + 2] !== undefined && s[i + 2] !== "=") out += String.fromCharCode((n >> 8) & 255);
        if (s[i + 3] !== undefined && s[i + 3] !== "=") out += String.fromCharCode(n & 255);
      }
      return out;
    };
  }
  // Pattern data is plain JSON, so a JSON round trip is a faithful deep copy.
  if (typeof g.structuredClone === "undefined") g.structuredClone = function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
  if (typeof g.console === "undefined") g.console = { log: function () {}, warn: function () {}, error: function () {} };
})(globalThis);
