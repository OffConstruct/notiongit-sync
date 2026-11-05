#!/usr/bin/env node
// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// node_modules/@notionhq/client/build/src/utils.js
var require_utils = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isObject = exports.pick = exports.assertNever = undefined;
  function assertNever(value) {
    throw new Error(`Unexpected value should never occur: ${value}`);
  }
  exports.assertNever = assertNever;
  function pick(base, keys) {
    const entries = keys.map((key) => [key, base === null || base === undefined ? undefined : base[key]]);
    return Object.fromEntries(entries);
  }
  exports.pick = pick;
  function isObject(o) {
    return typeof o === "object" && o !== null;
  }
  exports.isObject = isObject;
});

// node_modules/@notionhq/client/build/src/logging.js
var require_logging = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.logLevelSeverity = exports.makeConsoleLogger = exports.LogLevel = undefined;
  var utils_1 = require_utils();
  var LogLevel;
  (function(LogLevel) {
    LogLevel["DEBUG"] = "debug";
    LogLevel["INFO"] = "info";
    LogLevel["WARN"] = "warn";
    LogLevel["ERROR"] = "error";
  })(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
  function makeConsoleLogger(name) {
    return (level, message, extraInfo) => {
      console[level](`${name} ${level}:`, message, extraInfo);
    };
  }
  exports.makeConsoleLogger = makeConsoleLogger;
  function logLevelSeverity(level) {
    switch (level) {
      case LogLevel.DEBUG:
        return 20;
      case LogLevel.INFO:
        return 40;
      case LogLevel.WARN:
        return 60;
      case LogLevel.ERROR:
        return 80;
      default:
        return (0, utils_1.assertNever)(level);
    }
  }
  exports.logLevelSeverity = logLevelSeverity;
});

// node_modules/@notionhq/client/build/src/errors.js
var require_errors = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.buildRequestError = exports.APIResponseError = exports.UnknownHTTPResponseError = exports.isHTTPResponseError = exports.RequestTimeoutError = exports.isNotionClientError = exports.ClientErrorCode = exports.APIErrorCode = undefined;
  var utils_1 = require_utils();
  var APIErrorCode;
  (function(APIErrorCode) {
    APIErrorCode["Unauthorized"] = "unauthorized";
    APIErrorCode["RestrictedResource"] = "restricted_resource";
    APIErrorCode["ObjectNotFound"] = "object_not_found";
    APIErrorCode["RateLimited"] = "rate_limited";
    APIErrorCode["InvalidJSON"] = "invalid_json";
    APIErrorCode["InvalidRequestURL"] = "invalid_request_url";
    APIErrorCode["InvalidRequest"] = "invalid_request";
    APIErrorCode["ValidationError"] = "validation_error";
    APIErrorCode["ConflictError"] = "conflict_error";
    APIErrorCode["InternalServerError"] = "internal_server_error";
    APIErrorCode["ServiceUnavailable"] = "service_unavailable";
  })(APIErrorCode = exports.APIErrorCode || (exports.APIErrorCode = {}));
  var ClientErrorCode;
  (function(ClientErrorCode) {
    ClientErrorCode["RequestTimeout"] = "notionhq_client_request_timeout";
    ClientErrorCode["ResponseError"] = "notionhq_client_response_error";
  })(ClientErrorCode = exports.ClientErrorCode || (exports.ClientErrorCode = {}));

  class NotionClientErrorBase extends Error {
  }
  function isNotionClientError(error) {
    return (0, utils_1.isObject)(error) && error instanceof NotionClientErrorBase;
  }
  exports.isNotionClientError = isNotionClientError;
  function isNotionClientErrorWithCode(error, codes) {
    return isNotionClientError(error) && error.code in codes;
  }

  class RequestTimeoutError extends NotionClientErrorBase {
    constructor(message = "Request to Notion API has timed out") {
      super(message);
      this.code = ClientErrorCode.RequestTimeout;
      this.name = "RequestTimeoutError";
    }
    static isRequestTimeoutError(error) {
      return isNotionClientErrorWithCode(error, {
        [ClientErrorCode.RequestTimeout]: true
      });
    }
    static rejectAfterTimeout(promise, timeoutMS) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new RequestTimeoutError);
        }, timeoutMS);
        promise.then(resolve).catch(reject).then(() => clearTimeout(timeoutId));
      });
    }
  }
  exports.RequestTimeoutError = RequestTimeoutError;

  class HTTPResponseError extends NotionClientErrorBase {
    constructor(args) {
      super(args.message);
      this.name = "HTTPResponseError";
      const { code, status, headers, rawBodyText } = args;
      this.code = code;
      this.status = status;
      this.headers = headers;
      this.body = rawBodyText;
    }
  }
  var httpResponseErrorCodes = {
    [ClientErrorCode.ResponseError]: true,
    [APIErrorCode.Unauthorized]: true,
    [APIErrorCode.RestrictedResource]: true,
    [APIErrorCode.ObjectNotFound]: true,
    [APIErrorCode.RateLimited]: true,
    [APIErrorCode.InvalidJSON]: true,
    [APIErrorCode.InvalidRequestURL]: true,
    [APIErrorCode.InvalidRequest]: true,
    [APIErrorCode.ValidationError]: true,
    [APIErrorCode.ConflictError]: true,
    [APIErrorCode.InternalServerError]: true,
    [APIErrorCode.ServiceUnavailable]: true
  };
  function isHTTPResponseError(error) {
    if (!isNotionClientErrorWithCode(error, httpResponseErrorCodes)) {
      return false;
    }
    return true;
  }
  exports.isHTTPResponseError = isHTTPResponseError;

  class UnknownHTTPResponseError extends HTTPResponseError {
    constructor(args) {
      var _a;
      super({
        ...args,
        code: ClientErrorCode.ResponseError,
        message: (_a = args.message) !== null && _a !== undefined ? _a : `Request to Notion API failed with status: ${args.status}`
      });
      this.name = "UnknownHTTPResponseError";
    }
    static isUnknownHTTPResponseError(error) {
      return isNotionClientErrorWithCode(error, {
        [ClientErrorCode.ResponseError]: true
      });
    }
  }
  exports.UnknownHTTPResponseError = UnknownHTTPResponseError;
  var apiErrorCodes = {
    [APIErrorCode.Unauthorized]: true,
    [APIErrorCode.RestrictedResource]: true,
    [APIErrorCode.ObjectNotFound]: true,
    [APIErrorCode.RateLimited]: true,
    [APIErrorCode.InvalidJSON]: true,
    [APIErrorCode.InvalidRequestURL]: true,
    [APIErrorCode.InvalidRequest]: true,
    [APIErrorCode.ValidationError]: true,
    [APIErrorCode.ConflictError]: true,
    [APIErrorCode.InternalServerError]: true,
    [APIErrorCode.ServiceUnavailable]: true
  };

  class APIResponseError extends HTTPResponseError {
    constructor() {
      super(...arguments);
      this.name = "APIResponseError";
    }
    static isAPIResponseError(error) {
      return isNotionClientErrorWithCode(error, apiErrorCodes);
    }
  }
  exports.APIResponseError = APIResponseError;
  function buildRequestError(response, bodyText) {
    const apiErrorResponseBody = parseAPIErrorResponseBody(bodyText);
    if (apiErrorResponseBody !== undefined) {
      return new APIResponseError({
        code: apiErrorResponseBody.code,
        message: apiErrorResponseBody.message,
        headers: response.headers,
        status: response.status,
        rawBodyText: bodyText
      });
    }
    return new UnknownHTTPResponseError({
      message: undefined,
      headers: response.headers,
      status: response.status,
      rawBodyText: bodyText
    });
  }
  exports.buildRequestError = buildRequestError;
  function parseAPIErrorResponseBody(body) {
    if (typeof body !== "string") {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (parseError) {
      return;
    }
    if (!(0, utils_1.isObject)(parsed) || typeof parsed["message"] !== "string" || !isAPIErrorCode(parsed["code"])) {
      return;
    }
    return {
      ...parsed,
      code: parsed["code"],
      message: parsed["message"]
    };
  }
  function isAPIErrorCode(code) {
    return typeof code === "string" && code in apiErrorCodes;
  }
});

// node_modules/@notionhq/client/build/src/api-endpoints.js
var require_api_endpoints = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.oauthIntrospect = exports.oauthRevoke = exports.oauthToken = exports.listComments = exports.createComment = exports.search = exports.createDatabase = exports.listDatabases = exports.queryDatabase = exports.updateDatabase = exports.getDatabase = exports.appendBlockChildren = exports.listBlockChildren = exports.deleteBlock = exports.updateBlock = exports.getBlock = exports.getPageProperty = exports.updatePage = exports.getPage = exports.createPage = exports.listUsers = exports.getUser = exports.getSelf = undefined;
  exports.getSelf = {
    method: "get",
    pathParams: [],
    queryParams: [],
    bodyParams: [],
    path: () => `users/me`
  };
  exports.getUser = {
    method: "get",
    pathParams: ["user_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `users/${p.user_id}`
  };
  exports.listUsers = {
    method: "get",
    pathParams: [],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: () => `users`
  };
  exports.createPage = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["parent", "properties", "icon", "cover", "content", "children"],
    path: () => `pages`
  };
  exports.getPage = {
    method: "get",
    pathParams: ["page_id"],
    queryParams: ["filter_properties"],
    bodyParams: [],
    path: (p) => `pages/${p.page_id}`
  };
  exports.updatePage = {
    method: "patch",
    pathParams: ["page_id"],
    queryParams: [],
    bodyParams: ["properties", "icon", "cover", "archived", "in_trash"],
    path: (p) => `pages/${p.page_id}`
  };
  exports.getPageProperty = {
    method: "get",
    pathParams: ["page_id", "property_id"],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: (p) => `pages/${p.page_id}/properties/${p.property_id}`
  };
  exports.getBlock = {
    method: "get",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.updateBlock = {
    method: "patch",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [
      "embed",
      "type",
      "archived",
      "in_trash",
      "bookmark",
      "image",
      "video",
      "pdf",
      "file",
      "audio",
      "code",
      "equation",
      "divider",
      "breadcrumb",
      "table_of_contents",
      "link_to_page",
      "table_row",
      "heading_1",
      "heading_2",
      "heading_3",
      "paragraph",
      "bulleted_list_item",
      "numbered_list_item",
      "quote",
      "to_do",
      "toggle",
      "template",
      "callout",
      "synced_block",
      "table"
    ],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.deleteBlock = {
    method: "delete",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.listBlockChildren = {
    method: "get",
    pathParams: ["block_id"],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}/children`
  };
  exports.appendBlockChildren = {
    method: "patch",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: ["children", "after"],
    path: (p) => `blocks/${p.block_id}/children`
  };
  exports.getDatabase = {
    method: "get",
    pathParams: ["database_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `databases/${p.database_id}`
  };
  exports.updateDatabase = {
    method: "patch",
    pathParams: ["database_id"],
    queryParams: [],
    bodyParams: [
      "title",
      "description",
      "icon",
      "cover",
      "properties",
      "is_inline",
      "archived",
      "in_trash"
    ],
    path: (p) => `databases/${p.database_id}`
  };
  exports.queryDatabase = {
    method: "post",
    pathParams: ["database_id"],
    queryParams: ["filter_properties"],
    bodyParams: [
      "sorts",
      "filter",
      "start_cursor",
      "page_size",
      "archived",
      "in_trash"
    ],
    path: (p) => `databases/${p.database_id}/query`
  };
  exports.listDatabases = {
    method: "get",
    pathParams: [],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: () => `databases`
  };
  exports.createDatabase = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: [
      "parent",
      "properties",
      "icon",
      "cover",
      "title",
      "description",
      "is_inline"
    ],
    path: () => `databases`
  };
  exports.search = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["sort", "query", "start_cursor", "page_size", "filter"],
    path: () => `search`
  };
  exports.createComment = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["parent", "rich_text", "discussion_id"],
    path: () => `comments`
  };
  exports.listComments = {
    method: "get",
    pathParams: [],
    queryParams: ["block_id", "start_cursor", "page_size"],
    bodyParams: [],
    path: () => `comments`
  };
  exports.oauthToken = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["grant_type", "code", "redirect_uri", "external_account"],
    path: () => `oauth/token`
  };
  exports.oauthRevoke = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["token"],
    path: () => `oauth/revoke`
  };
  exports.oauthIntrospect = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["token"],
    path: () => `oauth/introspect`
  };
});

// node_modules/@notionhq/client/build/package.json
var require_package = __commonJS(function(exports, module) {
  module.exports = {
    name: "@notionhq/client",
    version: "2.3.0",
    description: "A simple and easy to use client for the Notion API",
    engines: {
      node: ">=12"
    },
    homepage: "https://developers.notion.com/docs/getting-started",
    bugs: {
      url: "https://github.com/makenotion/notion-sdk-js/issues"
    },
    repository: {
      type: "git",
      url: "https://github.com/makenotion/notion-sdk-js/"
    },
    keywords: [
      "notion",
      "notionapi",
      "rest",
      "notion-api"
    ],
    main: "./build/src",
    types: "./build/src/index.d.ts",
    scripts: {
      prepare: "npm run build",
      prepublishOnly: "npm run checkLoggedIn && npm run lint && npm run test",
      build: "tsc",
      prettier: "prettier --write .",
      lint: "prettier --check . && eslint . --ext .ts && cspell '**/*' ",
      test: "jest ./test",
      "check-links": "git ls-files | grep md$ | xargs -n 1 markdown-link-check",
      prebuild: "npm run clean",
      clean: "rm -rf ./build",
      checkLoggedIn: "./scripts/verifyLoggedIn.sh"
    },
    author: "",
    license: "MIT",
    files: [
      "build/package.json",
      "build/src/**"
    ],
    dependencies: {
      "@types/node-fetch": "^2.5.10",
      "node-fetch": "^2.6.1"
    },
    devDependencies: {
      "@types/jest": "^28.1.4",
      "@typescript-eslint/eslint-plugin": "^5.39.0",
      "@typescript-eslint/parser": "^5.39.0",
      cspell: "^5.4.1",
      eslint: "^7.24.0",
      jest: "^28.1.2",
      "markdown-link-check": "^3.8.7",
      prettier: "^2.8.8",
      "ts-jest": "^28.0.5",
      typescript: "^4.8.4"
    }
  };
});

// node_modules/@notionhq/client/build/src/Client.js
var require_Client = __commonJS(function(exports) {
  var __classPrivateFieldSet = exports && exports.__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var __classPrivateFieldGet = exports && exports.__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var _Client_auth;
  var _Client_logLevel;
  var _Client_logger;
  var _Client_prefixUrl;
  var _Client_timeoutMs;
  var _Client_notionVersion;
  var _Client_fetch;
  var _Client_agent;
  var _Client_userAgent;
  Object.defineProperty(exports, "__esModule", { value: true });
  var logging_1 = require_logging();
  var errors_1 = require_errors();
  var utils_1 = require_utils();
  var api_endpoints_1 = require_api_endpoints();
  var node_fetch_1 = __require("node-fetch");
  var package_json_1 = require_package();

  class Client {
    constructor(options) {
      var _a, _b, _c, _d, _e, _f;
      _Client_auth.set(this, undefined);
      _Client_logLevel.set(this, undefined);
      _Client_logger.set(this, undefined);
      _Client_prefixUrl.set(this, undefined);
      _Client_timeoutMs.set(this, undefined);
      _Client_notionVersion.set(this, undefined);
      _Client_fetch.set(this, undefined);
      _Client_agent.set(this, undefined);
      _Client_userAgent.set(this, undefined);
      this.blocks = {
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getBlock.path(args),
            method: api_endpoints_1.getBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updateBlock.path(args),
            method: api_endpoints_1.updateBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updateBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updateBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        delete: (args) => {
          return this.request({
            path: api_endpoints_1.deleteBlock.path(args),
            method: api_endpoints_1.deleteBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.deleteBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.deleteBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        children: {
          append: (args) => {
            return this.request({
              path: api_endpoints_1.appendBlockChildren.path(args),
              method: api_endpoints_1.appendBlockChildren.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.appendBlockChildren.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.appendBlockChildren.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          },
          list: (args) => {
            return this.request({
              path: api_endpoints_1.listBlockChildren.path(args),
              method: api_endpoints_1.listBlockChildren.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.listBlockChildren.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.listBlockChildren.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          }
        }
      };
      this.databases = {
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listDatabases.path(),
            method: api_endpoints_1.listDatabases.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listDatabases.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listDatabases.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getDatabase.path(args),
            method: api_endpoints_1.getDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        query: (args) => {
          return this.request({
            path: api_endpoints_1.queryDatabase.path(args),
            method: api_endpoints_1.queryDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.queryDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.queryDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createDatabase.path(),
            method: api_endpoints_1.createDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updateDatabase.path(args),
            method: api_endpoints_1.updateDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updateDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updateDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.pages = {
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createPage.path(),
            method: api_endpoints_1.createPage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createPage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createPage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getPage.path(args),
            method: api_endpoints_1.getPage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getPage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getPage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updatePage.path(args),
            method: api_endpoints_1.updatePage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updatePage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updatePage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        properties: {
          retrieve: (args) => {
            return this.request({
              path: api_endpoints_1.getPageProperty.path(args),
              method: api_endpoints_1.getPageProperty.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.getPageProperty.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.getPageProperty.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          }
        }
      };
      this.users = {
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getUser.path(args),
            method: api_endpoints_1.getUser.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getUser.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getUser.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listUsers.path(),
            method: api_endpoints_1.listUsers.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listUsers.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listUsers.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        me: (args) => {
          return this.request({
            path: api_endpoints_1.getSelf.path(),
            method: api_endpoints_1.getSelf.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getSelf.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getSelf.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.comments = {
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createComment.path(),
            method: api_endpoints_1.createComment.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createComment.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createComment.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listComments.path(),
            method: api_endpoints_1.listComments.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listComments.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listComments.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.search = (args) => {
        return this.request({
          path: api_endpoints_1.search.path(),
          method: api_endpoints_1.search.method,
          query: (0, utils_1.pick)(args, api_endpoints_1.search.queryParams),
          body: (0, utils_1.pick)(args, api_endpoints_1.search.bodyParams),
          auth: args === null || args === undefined ? undefined : args.auth
        });
      };
      this.oauth = {
        token: (args) => {
          return this.request({
            path: api_endpoints_1.oauthToken.path(),
            method: api_endpoints_1.oauthToken.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthToken.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthToken.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        },
        introspect: (args) => {
          return this.request({
            path: api_endpoints_1.oauthIntrospect.path(),
            method: api_endpoints_1.oauthIntrospect.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthIntrospect.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthIntrospect.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        },
        revoke: (args) => {
          return this.request({
            path: api_endpoints_1.oauthRevoke.path(),
            method: api_endpoints_1.oauthRevoke.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthRevoke.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthRevoke.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        }
      };
      __classPrivateFieldSet(this, _Client_auth, options === null || options === undefined ? undefined : options.auth, "f");
      __classPrivateFieldSet(this, _Client_logLevel, (_a = options === null || options === undefined ? undefined : options.logLevel) !== null && _a !== undefined ? _a : logging_1.LogLevel.WARN, "f");
      __classPrivateFieldSet(this, _Client_logger, (_b = options === null || options === undefined ? undefined : options.logger) !== null && _b !== undefined ? _b : (0, logging_1.makeConsoleLogger)(package_json_1.name), "f");
      __classPrivateFieldSet(this, _Client_prefixUrl, `${(_c = options === null || options === undefined ? undefined : options.baseUrl) !== null && _c !== undefined ? _c : "https://api.notion.com"}/v1/`, "f");
      __classPrivateFieldSet(this, _Client_timeoutMs, (_d = options === null || options === undefined ? undefined : options.timeoutMs) !== null && _d !== undefined ? _d : 60000, "f");
      __classPrivateFieldSet(this, _Client_notionVersion, (_e = options === null || options === undefined ? undefined : options.notionVersion) !== null && _e !== undefined ? _e : Client.defaultNotionVersion, "f");
      __classPrivateFieldSet(this, _Client_fetch, (_f = options === null || options === undefined ? undefined : options.fetch) !== null && _f !== undefined ? _f : node_fetch_1.default, "f");
      __classPrivateFieldSet(this, _Client_agent, options === null || options === undefined ? undefined : options.agent, "f");
      __classPrivateFieldSet(this, _Client_userAgent, `notionhq-client/${package_json_1.version}`, "f");
    }
    async request({ path, method, query, body, auth }) {
      this.log(logging_1.LogLevel.INFO, "request start", { method, path });
      const bodyAsJsonString = !body || Object.entries(body).length === 0 ? undefined : JSON.stringify(body);
      const url = new URL(`${__classPrivateFieldGet(this, _Client_prefixUrl, "f")}${path}`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              value.forEach((val) => url.searchParams.append(key, decodeURIComponent(val)));
            } else {
              url.searchParams.append(key, String(value));
            }
          }
        }
      }
      let authorizationHeader;
      if (typeof auth === "object") {
        const unencodedCredential = `${auth.client_id}:${auth.client_secret}`;
        const encodedCredential = Buffer.from(unencodedCredential).toString("base64");
        authorizationHeader = { authorization: `Basic ${encodedCredential}` };
      } else {
        authorizationHeader = this.authAsHeaders(auth);
      }
      const headers = {
        ...authorizationHeader,
        "Notion-Version": __classPrivateFieldGet(this, _Client_notionVersion, "f"),
        "user-agent": __classPrivateFieldGet(this, _Client_userAgent, "f")
      };
      if (bodyAsJsonString !== undefined) {
        headers["content-type"] = "application/json";
      }
      try {
        const response = await errors_1.RequestTimeoutError.rejectAfterTimeout(__classPrivateFieldGet(this, _Client_fetch, "f").call(this, url.toString(), {
          method: method.toUpperCase(),
          headers,
          body: bodyAsJsonString,
          agent: __classPrivateFieldGet(this, _Client_agent, "f")
        }), __classPrivateFieldGet(this, _Client_timeoutMs, "f"));
        const responseText = await response.text();
        if (!response.ok) {
          throw (0, errors_1.buildRequestError)(response, responseText);
        }
        const responseJson = JSON.parse(responseText);
        this.log(logging_1.LogLevel.INFO, "request success", { method, path });
        return responseJson;
      } catch (error) {
        if (!(0, errors_1.isNotionClientError)(error)) {
          throw error;
        }
        this.log(logging_1.LogLevel.WARN, "request fail", {
          code: error.code,
          message: error.message
        });
        if ((0, errors_1.isHTTPResponseError)(error)) {
          this.log(logging_1.LogLevel.DEBUG, "failed response body", {
            body: error.body
          });
        }
        throw error;
      }
    }
    log(level, message, extraInfo) {
      if ((0, logging_1.logLevelSeverity)(level) >= (0, logging_1.logLevelSeverity)(__classPrivateFieldGet(this, _Client_logLevel, "f"))) {
        __classPrivateFieldGet(this, _Client_logger, "f").call(this, level, message, extraInfo);
      }
    }
    authAsHeaders(auth) {
      const headers = {};
      const authHeaderValue = auth !== null && auth !== undefined ? auth : __classPrivateFieldGet(this, _Client_auth, "f");
      if (authHeaderValue !== undefined) {
        headers["authorization"] = `Bearer ${authHeaderValue}`;
      }
      return headers;
    }
  }
  exports.default = Client;
  _Client_auth = new WeakMap, _Client_logLevel = new WeakMap, _Client_logger = new WeakMap, _Client_prefixUrl = new WeakMap, _Client_timeoutMs = new WeakMap, _Client_notionVersion = new WeakMap, _Client_fetch = new WeakMap, _Client_agent = new WeakMap, _Client_userAgent = new WeakMap;
  Client.defaultNotionVersion = "2022-06-28";
});

// node_modules/@notionhq/client/build/src/helpers.js
var require_helpers = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isMentionRichTextItemResponse = exports.isEquationRichTextItemResponse = exports.isTextRichTextItemResponse = exports.isFullComment = exports.isFullUser = exports.isFullPageOrDatabase = exports.isFullDatabase = exports.isFullPage = exports.isFullBlock = exports.collectPaginatedAPI = exports.iteratePaginatedAPI = undefined;
  async function* iteratePaginatedAPI(listFn, firstPageArgs) {
    let nextCursor = firstPageArgs.start_cursor;
    do {
      const response = await listFn({
        ...firstPageArgs,
        start_cursor: nextCursor
      });
      yield* response.results;
      nextCursor = response.next_cursor;
    } while (nextCursor);
  }
  exports.iteratePaginatedAPI = iteratePaginatedAPI;
  async function collectPaginatedAPI(listFn, firstPageArgs) {
    const results = [];
    for await (const item of iteratePaginatedAPI(listFn, firstPageArgs)) {
      results.push(item);
    }
    return results;
  }
  exports.collectPaginatedAPI = collectPaginatedAPI;
  function isFullBlock(response) {
    return response.object === "block" && "type" in response;
  }
  exports.isFullBlock = isFullBlock;
  function isFullPage(response) {
    return response.object === "page" && "url" in response;
  }
  exports.isFullPage = isFullPage;
  function isFullDatabase(response) {
    return response.object === "database" && "title" in response;
  }
  exports.isFullDatabase = isFullDatabase;
  function isFullPageOrDatabase(response) {
    if (response.object === "database") {
      return isFullDatabase(response);
    } else {
      return isFullPage(response);
    }
  }
  exports.isFullPageOrDatabase = isFullPageOrDatabase;
  function isFullUser(response) {
    return "type" in response;
  }
  exports.isFullUser = isFullUser;
  function isFullComment(response) {
    return "created_by" in response;
  }
  exports.isFullComment = isFullComment;
  function isTextRichTextItemResponse(richText) {
    return richText.type === "text";
  }
  exports.isTextRichTextItemResponse = isTextRichTextItemResponse;
  function isEquationRichTextItemResponse(richText) {
    return richText.type === "equation";
  }
  exports.isEquationRichTextItemResponse = isEquationRichTextItemResponse;
  function isMentionRichTextItemResponse(richText) {
    return richText.type === "mention";
  }
  exports.isMentionRichTextItemResponse = isMentionRichTextItemResponse;
});

// node_modules/@notionhq/client/build/src/index.js
var require_src = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isFullPageOrDatabase = exports.isFullComment = exports.isFullUser = exports.isFullPage = exports.isFullDatabase = exports.isFullBlock = exports.iteratePaginatedAPI = exports.collectPaginatedAPI = exports.isNotionClientError = exports.RequestTimeoutError = exports.UnknownHTTPResponseError = exports.APIResponseError = exports.ClientErrorCode = exports.APIErrorCode = exports.LogLevel = exports.Client = undefined;
  var Client_1 = require_Client();
  Object.defineProperty(exports, "Client", { enumerable: true, get: function() {
    return Client_1.default;
  } });
  var logging_1 = require_logging();
  Object.defineProperty(exports, "LogLevel", { enumerable: true, get: function() {
    return logging_1.LogLevel;
  } });
  var errors_1 = require_errors();
  Object.defineProperty(exports, "APIErrorCode", { enumerable: true, get: function() {
    return errors_1.APIErrorCode;
  } });
  Object.defineProperty(exports, "ClientErrorCode", { enumerable: true, get: function() {
    return errors_1.ClientErrorCode;
  } });
  Object.defineProperty(exports, "APIResponseError", { enumerable: true, get: function() {
    return errors_1.APIResponseError;
  } });
  Object.defineProperty(exports, "UnknownHTTPResponseError", { enumerable: true, get: function() {
    return errors_1.UnknownHTTPResponseError;
  } });
  Object.defineProperty(exports, "RequestTimeoutError", { enumerable: true, get: function() {
    return errors_1.RequestTimeoutError;
  } });
  Object.defineProperty(exports, "isNotionClientError", { enumerable: true, get: function() {
    return errors_1.isNotionClientError;
  } });
  var helpers_1 = require_helpers();
  Object.defineProperty(exports, "collectPaginatedAPI", { enumerable: true, get: function() {
    return helpers_1.collectPaginatedAPI;
  } });
  Object.defineProperty(exports, "iteratePaginatedAPI", { enumerable: true, get: function() {
    return helpers_1.iteratePaginatedAPI;
  } });
  Object.defineProperty(exports, "isFullBlock", { enumerable: true, get: function() {
    return helpers_1.isFullBlock;
  } });
  Object.defineProperty(exports, "isFullDatabase", { enumerable: true, get: function() {
    return helpers_1.isFullDatabase;
  } });
  Object.defineProperty(exports, "isFullPage", { enumerable: true, get: function() {
    return helpers_1.isFullPage;
  } });
  Object.defineProperty(exports, "isFullUser", { enumerable: true, get: function() {
    return helpers_1.isFullUser;
  } });
  Object.defineProperty(exports, "isFullComment", { enumerable: true, get: function() {
    return helpers_1.isFullComment;
  } });
  Object.defineProperty(exports, "isFullPageOrDatabase", { enumerable: true, get: function() {
    return helpers_1.isFullPageOrDatabase;
  } });
});

// scripts/sync-notion.js
var require_sync_notion = __commonJS(function(exports, module) {
  var { Client } = require_src();
  var fs = __require("fs");
  var path = __require("path");

  class ConfigError extends Error {
  }
  function isTrue(value) {
    return String(value ?? "").trim().toLowerCase() === "true";
  }
  function resolveConfig(env = process.env) {
    const notionToken = String(env.NOTION_TOKEN ?? "").trim();
    if (!notionToken) {
      throw new ConfigError("NOTION_TOKEN environment variable is not set.");
    }
    const pagesDbId = String(env.NOTION_PAGES_DATABASE_ID ?? "").trim();
    const postsDbId = String(env.NOTION_POSTS_DATABASE_ID ?? "").trim() || String(env.NOTION_DATABASE_ID ?? "").trim();
    if (!pagesDbId && !postsDbId) {
      throw new ConfigError("Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.");
    }
    return {
      notionToken,
      pagesDbId,
      postsDbId,
      allowBulkDelete: isTrue(env.ALLOW_BULK_DELETE),
      maxDeleteRatio: Number(env.MAX_DELETE_RATIO) || 0.5,
      siteRoot: env.SITE_ROOT || path.join(import.meta.dir, ".."),
      notionBaseUrl: env.NOTION_BASE_URL || ""
    };
  }
  var notion;
  var PAGES_DB_ID;
  var POSTS_DB_ID;
  var ALLOW_BULK_DELETE;
  var MAX_DELETE_RATIO;
  var ROOT_DIR;
  var POSTS_DIR;
  var PAGES_DIR;
  var DATA_DIR;
  var ASSETS_DIR;
  var ASSET_URL_PREFIX;
  var TEST_FILE_HOST;
  function initRun(config) {
    PAGES_DB_ID = config.pagesDbId;
    POSTS_DB_ID = config.postsDbId;
    ALLOW_BULK_DELETE = config.allowBulkDelete;
    MAX_DELETE_RATIO = config.maxDeleteRatio;
    notion = new Client({
      auth: config.notionToken,
      ...config.notionBaseUrl ? { baseUrl: config.notionBaseUrl } : {}
    });
    ROOT_DIR = path.resolve(config.siteRoot);
    POSTS_DIR = path.join(ROOT_DIR, "_posts");
    PAGES_DIR = path.join(ROOT_DIR, "_pages");
    DATA_DIR = path.join(ROOT_DIR, "_data");
    ASSETS_DIR = path.join(ROOT_DIR, ...ASSETS_SUBDIR.split("/"));
    ASSET_URL_PREFIX = `${readConfigBaseurl()}/${ASSETS_SUBDIR}/`;
    TEST_FILE_HOST = config.notionBaseUrl ? new URL(config.notionBaseUrl).host : null;
  }
  function readConfigBaseurl() {
    try {
      const config = fs.readFileSync(path.join(ROOT_DIR, "_config.yml"), "utf8");
      const match = config.match(/^baseurl:[ \t]*["']?([^"'#\n]*?)["']?[ \t]*(#.*)?$/m);
      return (match?.[1] ?? "").trim().replace(/\/+$/, "");
    } catch {
      return "";
    }
  }
  function richTextToMarkdown(richText = []) {
    return richText.map((item) => {
      let text = item.plain_text ?? "";
      if (!text)
        return "";
      const ann = item.annotations ?? {};
      const href = item.href;
      if (ann.code)
        text = `\`${text}\``;
      if (ann.bold && ann.italic)
        text = `***${text}***`;
      else if (ann.bold)
        text = `**${text}**`;
      else if (ann.italic)
        text = `*${text}*`;
      if (ann.strikethrough)
        text = `~~${text}~~`;
      if (href)
        text = `[${text}](${href})`;
      return text;
    }).join("");
  }
  function richTextToPlain(richText = []) {
    return (richText ?? []).map((item) => item?.plain_text ?? "").join("");
  }
  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function indent(text, spaces) {
    const pad = " ".repeat(spaces);
    return text.split(`
`).map((line) => line ? pad + line : line).join(`
`);
  }
  function quoteLines(text) {
    return text.split(`
`).map((line) => line ? `> ${line}` : ">").join(`
`);
  }
  function listItem(marker, text, children) {
    if (children.length === 0)
      return `${marker}${text}`;
    const nested = blocksToMarkdown(children);
    if (!nested)
      return `${marker}${text}`;
    const gap = LIST_TYPES.has(children[0].type) ? `
` : `

`;
    return `${marker}${text}${gap}${indent(nested, marker.length)}`;
  }
  function withChildren(text, children) {
    const nested = children.length ? blocksToMarkdown(children) : "";
    if (!nested)
      return text;
    return text ? `${text}

${nested}` : nested;
  }
  function tableCell(richText) {
    return richTextToMarkdown(richText).replace(/\|/g, "\\|").replace(/\n/g, " ");
  }
  function tableToMarkdown(data, rows) {
    const cells = rows.filter((row) => row.type === "table_row").map((row) => `| ${(row.table_row?.cells ?? []).map(tableCell).join(" | ")} |`);
    if (cells.length === 0)
      return null;
    if (!data.has_column_header)
      return cells.join(`
`);
    const width = rows[0]?.table_row?.cells?.length ?? 1;
    const rule = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
    return [cells[0], rule, ...cells.slice(1)].join(`
`);
  }
  function fileBlockUrl(block, data) {
    if (data.type === "external")
      return data.external?.url ?? "";
    return block._local_url ?? null;
  }
  function blockToMarkdown(block) {
    const type = block.type;
    const data = block[type];
    if (!data)
      return null;
    const children = block.children ?? [];
    switch (type) {
      case "paragraph":
        return withChildren(richTextToMarkdown(data.rich_text), children);
      case "heading_1":
        return withChildren(`# ${richTextToMarkdown(data.rich_text)}`, children);
      case "heading_2":
        return withChildren(`## ${richTextToMarkdown(data.rich_text)}`, children);
      case "heading_3":
        return withChildren(`### ${richTextToMarkdown(data.rich_text)}`, children);
      case "bulleted_list_item":
        return listItem("- ", richTextToMarkdown(data.rich_text), children);
      case "numbered_list_item":
        return listItem("1. ", richTextToMarkdown(data.rich_text), children);
      case "to_do":
        return listItem("- ", `[${data.checked ? "x" : " "}] ${richTextToMarkdown(data.rich_text)}`, children);
      case "code": {
        const lang = data.language && data.language !== "plain text" ? data.language : "";
        const code = (data.rich_text ?? []).map((r) => r.plain_text).join("");
        const caption = richTextToMarkdown(data.caption ?? []);
        const block_md = `\`\`\`${lang}
${code}
\`\`\``;
        return caption ? `${block_md}
*${caption}*` : block_md;
      }
      case "quote":
        return quoteLines(withChildren(richTextToMarkdown(data.rich_text), children));
      case "callout": {
        const icon = data.icon?.emoji ? `${data.icon.emoji} ` : "";
        return quoteLines(withChildren(`${icon}${richTextToMarkdown(data.rich_text)}`, children));
      }
      case "divider":
        return "---";
      case "image": {
        const url = fileBlockUrl(block, data);
        if (!url)
          return null;
        const caption = richTextToMarkdown(data.caption ?? []);
        return `![${caption}](${url})`;
      }
      case "video": {
        const url = fileBlockUrl(block, data);
        if (!url)
          return null;
        const caption = richTextToMarkdown(data.caption ?? []);
        return caption ? `[\u25B6 ${caption}](${url})` : `[\u25B6 Watch video](${url})`;
      }
      case "file":
      case "pdf":
      case "audio": {
        const url = fileBlockUrl(block, data);
        if (!url)
          return null;
        const label = richTextToMarkdown(data.caption ?? []) || data.name || "Download the file";
        return `[${label}](${url})`;
      }
      case "bookmark":
      case "link_preview":
      case "embed": {
        const url = data.url ?? "";
        if (!url)
          return null;
        const caption = richTextToMarkdown(data.caption ?? []);
        return `[${caption || url}](${url})`;
      }
      case "equation":
        return data.expression ? `\`${data.expression}\`` : null;
      case "toggle": {
        const summary = escapeHtml(richTextToPlain(data.rich_text));
        const body = children.length ? blocksToMarkdown(children) : "";
        return `<details markdown="1">
<summary>${summary}</summary>

${body ? `${body}

` : ""}</details>`;
      }
      case "column_list":
      case "column":
      case "synced_block":
        return children.length ? blocksToMarkdown(children) || null : null;
      case "table":
        return tableToMarkdown(data, children);
      case "table_of_contents":
        return "";
      case "child_page":
      case "child_database":
        return null;
      default:
        return null;
    }
  }
  var LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);
  function blocksToMarkdown(blocks) {
    const lines = [];
    for (let i = 0;i < blocks.length; i++) {
      const block = blocks[i];
      const md = blockToMarkdown(block);
      if (md === null)
        continue;
      const prevBlock = i > 0 ? blocks[i - 1] : null;
      const isList = LIST_TYPES.has(block.type);
      const prevIsList = prevBlock ? LIST_TYPES.has(prevBlock.type) : false;
      if (lines.length > 0 && !(isList && prevIsList))
        lines.push("");
      if (md !== "")
        lines.push(md);
    }
    return lines.join(`
`).trim();
  }
  function protectLiquid(body) {
    if (!/\{[{%]/.test(body))
      return body;
    const safe = body.replace(/\{%-?\s*endraw\s*-?%\}/g, '{% endraw %}{{ "{%" }} endraw %}{% raw %}');
    return `{% raw %}
${safe}
{% endraw %}`;
  }
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function withRateLimitRetry(call) {
    for (let attempt = 0;; attempt++) {
      try {
        return await call();
      } catch (err) {
        if (err?.code !== "rate_limited" || attempt >= 3)
          throw err;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  async function fetchAllBlocks(blockId) {
    const blocks = [];
    let cursor;
    do {
      const res = await withRateLimitRetry(() => notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      }));
      blocks.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return blocks;
  }
  async function fetchPublished(databaseId, statusValue = "Published") {
    const pages = [];
    let cursor;
    do {
      const res = await withRateLimitRetry(() => notion.databases.query({
        database_id: databaseId,
        filter: { property: "Status", select: { equals: statusValue } },
        start_cursor: cursor
      }));
      pages.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return pages;
  }
  var RENDERED_BLOCK_TYPES = new Set([
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "to_do",
    "code",
    "quote",
    "callout",
    "divider",
    "image",
    "video",
    "file",
    "pdf",
    "audio",
    "bookmark",
    "link_preview",
    "embed",
    "equation",
    "toggle",
    "column_list",
    "column",
    "synced_block",
    "table",
    "table_row"
  ]);
  var SILENT_BLOCK_TYPES = new Set(["table_of_contents", "breadcrumb"]);
  var FILE_BLOCK_TYPES = new Set(["image", "video", "file", "pdf", "audio"]);
  var MAX_BLOCK_DEPTH = 3;
  async function prepareBlocks(blocks, ctx, depth = 1) {
    for (const block of blocks) {
      if (!RENDERED_BLOCK_TYPES.has(block.type)) {
        if (!SILENT_BLOCK_TYPES.has(block.type))
          ctx.skippedBlocks++;
        continue;
      }
      const syncedFrom = block.type === "synced_block" ? block.synced_block?.synced_from?.block_id : null;
      if (block.has_children || syncedFrom) {
        if (depth >= MAX_BLOCK_DEPTH) {
          ctx.skippedBlocks++;
        } else if (syncedFrom) {
          try {
            block.children = await fetchAllBlocks(syncedFrom);
            await prepareBlocks(block.children, ctx, depth + 1);
          } catch {
            ctx.skippedBlocks++;
          }
        } else {
          block.children = await fetchAllBlocks(block.id);
          await prepareBlocks(block.children, ctx, depth + 1);
        }
      }
      const data = block[block.type];
      if (FILE_BLOCK_TYPES.has(block.type) && data?.type === "file") {
        block._local_url = await localizeFile(data.file?.url, ctx);
      }
    }
  }
  async function renderPageBody(pageId, ctx) {
    const blocks = await fetchAllBlocks(pageId);
    await prepareBlocks(blocks, ctx);
    return blocksToMarkdown(blocks);
  }
  var ASSETS_SUBDIR = "assets/notion";
  var NOTION_FILE_HOSTS = [
    "prod-files-secure.s3.us-west-2.amazonaws.com",
    "s3.us-west-2.amazonaws.com",
    "file.notion.so"
  ];
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var MAX_FILE_MB = MAX_FILE_BYTES / (1024 * 1024);
  var FILE_TYPES = {
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    avif: "image",
    mp4: "video",
    webm: "video",
    mov: "video",
    m4v: "video",
    mp3: "audio",
    m4a: "audio",
    wav: "audio",
    ogg: "audio",
    pdf: "application",
    epub: "application",
    zip: "application",
    doc: "application",
    docx: "application",
    xls: "application",
    xlsx: "application",
    ppt: "application",
    pptx: "application",
    odt: "application",
    ods: "application",
    odp: "application",
    txt: "text",
    csv: "text"
  };
  var GENERIC_CONTENT_TYPES = new Set(["application/octet-stream", "binary/octet-stream"]);

  class FileProblem extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  function stableHash(text) {
    let h1 = 3735928559;
    let h2 = 1103547991;
    for (let i = 0;i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0").slice(0, 12);
  }
  function isAllowedFileUrl(url) {
    if (TEST_FILE_HOST && url.host === TEST_FILE_HOST)
      return true;
    return url.protocol === "https:" && NOTION_FILE_HOSTS.includes(url.hostname);
  }
  function safeFileName(raw) {
    let name;
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
    const stem = slugify(dot > 0 ? name.slice(0, dot) : name).slice(0, 60) || "file";
    return { stem, ext };
  }
  async function readCapped(res) {
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES)
      throw new FileProblem("file_too_large");
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.byteLength;
      if (size > MAX_FILE_BYTES)
        throw new FileProblem("file_too_large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  async function downloadFile(url, family, dest) {
    let res;
    try {
      res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
    } catch {
      throw new FileProblem("file_unavailable");
    }
    let finalUrl;
    try {
      finalUrl = new URL(res.url || url.href);
    } catch {
      finalUrl = url;
    }
    if (!res.ok || !isAllowedFileUrl(finalUrl))
      throw new FileProblem("file_unavailable");
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType && !GENERIC_CONTENT_TYPES.has(contentType) && contentType.split("/")[0] !== family) {
      throw new FileProblem("file_type_unsupported");
    }
    const bytes = await readCapped(res);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const partial = `${dest}.partial`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, dest);
  }
  async function localizeFile(rawUrl, ctx) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return noteFileProblem(ctx, "file_unavailable");
    }
    if (!isAllowedFileUrl(url))
      return noteFileProblem(ctx, "file_unavailable");
    const { stem, ext } = safeFileName(url.pathname.split("/").pop() ?? "");
    const family = FILE_TYPES[ext];
    if (!family)
      return noteFileProblem(ctx, "file_type_unsupported");
    const name = `${stableHash(url.pathname)}-${stem}.${ext}`;
    const dest = path.join(ASSETS_DIR, name);
    if (!fs.existsSync(dest)) {
      try {
        await downloadFile(url, family, dest);
        ctx.assets.downloaded++;
        console.log(`     downloaded: ${ASSETS_SUBDIR}/${name}`);
      } catch (err) {
        return noteFileProblem(ctx, err instanceof FileProblem ? err.code : "file_unavailable");
      }
    }
    return `${ASSET_URL_PREFIX}${name}`;
  }
  function noteFileProblem(ctx, code) {
    ctx.fileProblems.push(code);
    console.warn(`     [skipped file] ${FILE_PROBLEM_TEXT[code] ?? code}`);
    return null;
  }
  async function filesPropertyUrl(prop, ctx) {
    const first = prop?.files?.[0];
    if (!first)
      return "";
    if (first.type === "external" || first.external)
      return first.external?.url ?? "";
    return await localizeFile(first.file?.url, ctx) ?? "";
  }
  function pruneAssets() {
    if (!fs.existsSync(ASSETS_DIR))
      return 0;
    const linked = new Set;
    const scan = (file) => {
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        return;
      }
      for (const m of text.matchAll(/assets\/notion\/([A-Za-z0-9._-]+)/g))
        linked.add(m[1]);
    };
    for (const dir of [POSTS_DIR, PAGES_DIR]) {
      if (!fs.existsSync(dir))
        continue;
      for (const f of fs.readdirSync(dir))
        if (f.endsWith(".md"))
          scan(path.join(dir, f));
    }
    scan(path.join(DATA_DIR, "home.yml"));
    let removed = 0;
    for (const f of fs.readdirSync(ASSETS_DIR)) {
      if (linked.has(f))
        continue;
      try {
        fs.unlinkSync(path.join(ASSETS_DIR, f));
        removed++;
        console.log(`   removed (no longer used): ${ASSETS_SUBDIR}/${f}`);
      } catch {}
    }
    return removed;
  }
  var TRANSLITERATE = { \u{df}: "ss", \u{e6}: "ae", \u{153}: "oe", \u{f8}: "o", \u{111}: "d", \u{f0}: "d", \u{142}: "l", \u{fe}: "th", \u{131}: "i" };
  function slugify(text) {
    return String(text ?? "").normalize("NFKD").replace(/[\u0300-\u036F]/g, "").toLowerCase().replace(/[\u00DF\u00E6\u0153\u00F8\u0111\u00F0\u0142\u00FE\u0131]/g, (ch) => TRANSLITERATE[ch]).replace(/['\u2019"`]/g, "").replace(/[^a-z0-9_]+/g, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 80).replace(/[-_]+$/, "");
  }
  function titleToSlug(title) {
    return slugify(title);
  }
  var SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
  function resolveSlug({ typed, title, existingSlug, pageId }) {
    const typedClean = String(typed ?? "").trim();
    if (typedClean) {
      if (SAFE_SLUG.test(typedClean))
        return typedClean;
      const cleaned = slugify(typedClean);
      if (cleaned)
        return cleaned;
    }
    if (existingSlug && SAFE_SLUG.test(existingSlug))
      return existingSlug;
    return slugify(title) || `page-${String(pageId).replace(/-/g, "").slice(0, 8)}`;
  }
  function yamlStr(value) {
    return JSON.stringify(String(value ?? ""));
  }
  function findProp(props, names) {
    for (const name of names) {
      if (props[name] !== undefined)
        return props[name];
    }
    return;
  }
  function propText(prop) {
    if (!prop)
      return "";
    if (Array.isArray(prop.title))
      return richTextToPlain(prop.title);
    if (Array.isArray(prop.rich_text))
      return richTextToPlain(prop.rich_text);
    return "";
  }
  function rowTitle(props) {
    const titleProp = Object.values(props).find((prop) => prop?.type === "title") ?? findProp(props, ["Title", "title", "Name"]);
    return propText(titleProp).trim() || "Untitled";
  }
  var PAGE_COLUMNS = {
    slug: ["Slug", "slug", "Web address", "Web Address"],
    type: ["Type", "type"],
    navOrder: ["Nav Order", "Nav order", "Order", "Menu order", "Menu Order"],
    showInNav: ["Show in Nav", "Show In Nav", "Nav", "Show in menu", "Show in Menu"],
    description: ["Description", "Excerpt", "Summary"],
    name: ["Name", "Display Name", "Author Name"],
    picture: ["Profile Picture", "Avatar", "Photo"],
    tagline: ["Tagline", "Short Bio", "Subtitle"],
    social: ["Social Links", "Socials", "Links"]
  };
  var POST_COLUMNS = {
    slug: ["Slug", "slug", "Web address", "Web Address"],
    date: ["Publish Date", "Date", "Published"],
    tags: ["Tags"],
    description: ["Description", "Excerpt", "Summary"],
    cover: ["Cover Image", "Cover image", "Cover"],
    canonical: ["Canonical URL", "Originally published at"],
    featured: ["Featured"]
  };
  var TYPE_LABELS = {
    "home page": "home",
    "list of posts": "blog-list",
    "regular page": "markdown"
  };
  function normalizePageType(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value)
      return "markdown";
    return TYPE_LABELS[value] ?? value;
  }
  var SAMPLE_SLUGS = new Set(["welcome-to-inkdrafts"]);
  function readFrontMatter(file) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const head = text.startsWith("---") ? text.slice(0, text.indexOf(`
---`, 3) + 1) : "";
      const field = (key) => {
        const m = head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
        if (!m)
          return "";
        const raw = m[1].trim();
        if (raw.startsWith('"')) {
          try {
            return JSON.parse(raw);
          } catch {
            return raw.slice(1, -1);
          }
        }
        return raw;
      };
      return { slug: field("slug"), title: field("title") };
    } catch {
      return { slug: "", title: "" };
    }
  }
  function applyDeletions(dir, label, notionIdToFile, processedIds) {
    const stale = [...notionIdToFile].filter(([id]) => !processedIds.has(id));
    if (stale.length === 0)
      return { deleted: 0, guard: null };
    const tracked = notionIdToFile.size;
    const ratio = stale.length / tracked;
    const fronts = stale.map(([, f]) => readFrontMatter(path.join(dir, f)));
    const onlySamples = fronts.every((fm) => SAMPLE_SLUGS.has(fm.slug));
    const suspicious = !onlySamples && (processedIds.size === 0 || stale.length > 2 && ratio > MAX_DELETE_RATIO);
    if (suspicious && !ALLOW_BULK_DELETE) {
      console.error(`
   HELD BACK: this sync would delete ${stale.length} of ${tracked} tracked ${label} ` + `(${Math.round(ratio * 100)}%).
` + `   Notion returned ${processedIds.size} published row(s), which usually means the
` + `   database was misread \u2014 a renamed Status option, a revoked integration share,
` + `   or a partial API response \u2014 not that you unpublished them.

` + `   Would have deleted:
` + stale.map(([, f]) => `     - ${f}`).join(`
`) + `

` + `   Those files were kept. Check the database in Notion. If the deletion is real,
` + `   re-run this workflow with ALLOW_BULK_DELETE=true.`);
      return {
        deleted: 0,
        guard: {
          label,
          staleCount: stale.length,
          trackedCount: tracked,
          ratio,
          titles: fronts.map((fm, i) => fm.title || stale[i][1])
        }
      };
    }
    if (suspicious) {
      console.log(`
   ALLOW_BULK_DELETE set \u2014 deleting ${stale.length} of ${tracked} ${label}.`);
    }
    let deleted = 0;
    for (const [, filename] of stale) {
      try {
        fs.unlinkSync(path.join(dir, filename));
        deleted++;
        console.log(`
   removed (unpublished): ${filename}`);
      } catch {
        console.warn(`   Warning: could not remove ${filename}`);
      }
    }
    return { deleted, guard: null };
  }
  function buildNavYaml(items) {
    if (items.length === 0)
      return `[]
`;
    return items.map((item) => `- title: ${yamlStr(item.title)}
  url: ${yamlStr(item.url)}`).join(`
`) + `
`;
  }
  function buildHomeYaml(data) {
    const lines = [];
    lines.push(`name: ${yamlStr(data.name)}`);
    lines.push(`tagline: ${yamlStr(data.tagline)}`);
    lines.push(`profile_picture: ${yamlStr(data.profile_picture)}`);
    if (data.social_links && data.social_links.length > 0) {
      lines.push("social_links:");
      for (const link of data.social_links) {
        lines.push(`  - name: ${yamlStr(link.name)}`);
        lines.push(`    url: ${yamlStr(link.url)}`);
      }
    } else {
      lines.push("social_links: []");
    }
    if (data.bio) {
      lines.push("bio: |");
      for (const line of data.bio.split(`
`)) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push('bio: ""');
    }
    lines.push(`notion_id: ${yamlStr(data.notion_id)}`);
    return lines.join(`
`) + `
`;
  }
  var LEGACY_DESCRIPTION = "A Notion-powered Jekyll site.";
  var NEUTRAL_DESCRIPTION = "A personal website, written in Notion.";
  function syncConfigIdentity(name, description = "") {
    if (!name)
      return false;
    const configPath = path.join(ROOT_DIR, "_config.yml");
    let original;
    try {
      original = fs.readFileSync(configPath, "utf8");
    } catch {
      console.warn("   Warning: _config.yml not readable \u2014 site title left unchanged.");
      return false;
    }
    let inAuthor = false;
    let sawTitle = false;
    let sawAuthorName = false;
    const updated = original.split(`
`).map((line) => {
      const isBlank = line.trim() === "";
      const isIndented = /^[ \t]/.test(line);
      if (!isBlank && !isIndented)
        inAuthor = /^author:[ \t]*(#.*)?$/.test(line);
      if (!isIndented && /^title:/.test(line)) {
        sawTitle = true;
        return `title: ${yamlStr(name)}`;
      }
      if (!isIndented && /^description:/.test(line)) {
        if (description)
          return `description: ${yamlStr(description)}`;
        if (line.includes(LEGACY_DESCRIPTION))
          return `description: ${yamlStr(NEUTRAL_DESCRIPTION)}`;
        return line;
      }
      if (inAuthor && isIndented && /^[ \t]+name:/.test(line)) {
        sawAuthorName = true;
        return `${line.match(/^[ \t]+/)[0]}name: ${yamlStr(name)}`;
      }
      return line;
    }).join(`
`);
    if (!sawTitle)
      console.warn("   Warning: no top-level `title:` in _config.yml \u2014 tab title not updated.");
    if (!sawAuthorName)
      console.warn("   Warning: no `author.name` in _config.yml \u2014 feed author not updated.");
    if (updated === original) {
      console.log("   unchanged: _config.yml");
      return false;
    }
    fs.writeFileSync(configPath, updated, "utf8");
    console.log(`   updated: _config.yml (site title \u2192 ${name})`);
    return true;
  }
  function parseSocialLinks(raw) {
    if (!raw || !raw.trim())
      return [];
    return raw.split(`
`).map((line) => line.trim()).filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1)
        return null;
      const name = line.slice(0, colonIdx).trim();
      const url = line.slice(colonIdx + 1).trim();
      if (!name || !url)
        return null;
      return { name, url: url.startsWith("//") ? `https:${url}` : url };
    }).filter(Boolean);
  }
  function newStats() {
    return { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0, scheduled: 0, skipped_blocks: 0 };
  }
  function rowContext(section, title, assets) {
    return { section, title, skippedBlocks: 0, fileProblems: [], assets };
  }
  function recordSkipped(report, ctx) {
    report.stats.skipped_blocks += ctx.skippedBlocks;
    if (ctx.skippedBlocks > 0) {
      report.skipped.push({ section: ctx.section, title: ctx.title, reason_code: "blocks_unsupported", count: ctx.skippedBlocks });
    }
    const byCode = new Map;
    for (const code of ctx.fileProblems)
      byCode.set(code, (byCode.get(code) ?? 0) + 1);
    for (const [code, count] of byCode) {
      report.skipped.push({ section: ctx.section, title: ctx.title, reason_code: code, count });
    }
  }
  function indexByNotionId(dir) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const notionIdToFile = new Map;
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf8");
        const match = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
        if (match)
          notionIdToFile.set(match[1], file);
      } catch {}
    }
    return { files, notionIdToFile };
  }
  function findAddressClashes(planned, notionIdToFile) {
    const byFile = new Map;
    for (const item of planned) {
      const list = byFile.get(item.filename) ?? [];
      list.push(item);
      byFile.set(item.filename, list);
    }
    const losers = new Set;
    for (const [filename, list] of byFile) {
      if (list.length < 2)
        continue;
      const owner = list.find((item) => notionIdToFile.get(item.page.id) === filename) ?? list[0];
      for (const item of list)
        if (item !== owner)
          losers.add(item.page.id);
    }
    return losers;
  }
  function writeRowFile(dir, label, filename, content, prevFilename, existingFiles, stats) {
    const filePath = path.join(dir, filename);
    const renamed = Boolean(prevFilename && prevFilename !== filename);
    if (renamed) {
      try {
        fs.unlinkSync(path.join(dir, prevFilename));
      } catch {}
      stats.renamed++;
      console.log(`     renamed: ${prevFilename} \u2192 ${filename}`);
    }
    const needsWrite = !fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== content;
    if (!needsWrite) {
      console.log("     unchanged");
      stats.unchanged++;
      return;
    }
    fs.writeFileSync(filePath, content, "utf8");
    if (renamed) {
      console.log(`     wrote: ${label}${filename}`);
      return;
    }
    const isNew = !existingFiles.includes(filename);
    console.log(`     ${isNew ? "created" : "updated"}: ${label}${filename}`);
    isNew ? stats.created++ : stats.updated++;
  }
  function rowFailure(report, section, title, reasonCode, err) {
    report.stats.errors++;
    report.failed.push({ section, title, reason_code: reasonCode });
    console.error(`     [error] ${err ? err.message : ROW_PROBLEM_TEXT[reasonCode]}`);
  }
  function reasonForRowError(err) {
    return err && typeof err.code === "string" && err.status ? "read_failed" : "unexpected";
  }
  function extractPageMeta(page, existingSlug = "") {
    const props = page.properties;
    const title = rowTitle(props);
    const slug = resolveSlug({
      typed: propText(findProp(props, PAGE_COLUMNS.slug)),
      title,
      existingSlug,
      pageId: page.id
    });
    const type = normalizePageType(findProp(props, PAGE_COLUMNS.type)?.select?.name);
    const navOrder = findProp(props, PAGE_COLUMNS.navOrder)?.number ?? 99;
    const showInNav = findProp(props, PAGE_COLUMNS.showInNav)?.checkbox ?? false;
    const description = propText(findProp(props, PAGE_COLUMNS.description)).trim();
    const displayName = propText(findProp(props, PAGE_COLUMNS.name)).trim() || title;
    const picProp = findProp(props, PAGE_COLUMNS.picture);
    const profile_picture = propText(picProp).trim();
    const tagline = propText(findProp(props, PAGE_COLUMNS.tagline)).trim();
    const socialRaw = propText(findProp(props, PAGE_COLUMNS.social));
    const social_links = parseSocialLinks(socialRaw);
    return { title, displayName, slug, type, navOrder, showInNav, description, profile_picture, tagline, social_links };
  }
  function buildPageFrontMatter(meta, notionId, layout) {
    const lines = ["---"];
    lines.push(`layout: ${layout}`);
    lines.push(`title: ${yamlStr(meta.title)}`);
    lines.push(`slug: ${yamlStr(meta.slug)}`);
    if (meta.description)
      lines.push(`description: ${yamlStr(meta.description)}`);
    lines.push(`notion_id: ${yamlStr(notionId)}`);
    lines.push("---");
    return lines.join(`
`);
  }
  function typeToLayout(type) {
    switch (normalizePageType(type)) {
      case "blog-list":
      case "blog":
        return "blog";
      case "home":
        return "home";
      default:
        return "page";
    }
  }
  function newReport() {
    return { stats: newStats(), failed: [], skipped: [], guard: null };
  }
  async function syncPages(assets) {
    console.log(`
\u2500\u2500 Pages sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    console.log(`   Database: ${PAGES_DB_ID}`);
    fs.mkdirSync(PAGES_DIR, { recursive: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const { files: existingFiles, notionIdToFile } = indexByNotionId(PAGES_DIR);
    let publishedPages;
    try {
      publishedPages = await fetchPublished(PAGES_DB_ID);
    } catch (err) {
      throw new Error(`Error querying pages database: ${err.message}`);
    }
    console.log(`   Published pages in Notion: ${publishedPages.length}
`);
    const navItems = [];
    let homeData = null;
    const processedIds = new Set;
    const report = newReport();
    const { stats } = report;
    const planned = [];
    for (const page of publishedPages) {
      processedIds.add(page.id);
      const prev = notionIdToFile.get(page.id);
      let meta;
      try {
        meta = extractPageMeta(page, prev ? readFrontMatter(path.join(PAGES_DIR, prev)).slug : "");
      } catch (err) {
        console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
        rowFailure(report, "pages", rowTitleSafe(page), "unexpected", err);
        continue;
      }
      planned.push({ page, meta, filename: meta.type === "home" ? null : `${meta.slug}.md` });
    }
    const clashes = findAddressClashes(planned.filter((p) => p.filename), notionIdToFile);
    for (const { page, meta, filename } of planned) {
      console.log(`   \u2192 "${meta.title}" (${meta.type}, /${meta.slug})`);
      if (clashes.has(page.id)) {
        rowFailure(report, "pages", meta.title, "duplicate_web_address");
        continue;
      }
      if (meta.showInNav) {
        navItems.push({
          title: meta.title,
          url: meta.type === "home" ? "/" : `/${meta.slug}`,
          order: meta.navOrder
        });
      }
      const ctx = rowContext("pages", meta.title, assets);
      if (meta.type === "home") {
        try {
          const bio = await renderPageBody(page.id, ctx);
          const picProp = findProp(page.properties, PAGE_COLUMNS.picture);
          const profile_picture = picProp?.files ? await filesPropertyUrl(picProp, ctx) : meta.profile_picture;
          homeData = {
            name: meta.displayName,
            tagline: meta.tagline,
            description: meta.description,
            profile_picture,
            social_links: meta.social_links,
            bio,
            notion_id: page.id
          };
          recordSkipped(report, ctx);
          console.log("     home data collected");
        } catch (err) {
          rowFailure(report, "pages", meta.title, reasonForRowError(err), err);
        }
        continue;
      }
      try {
        const body = protectLiquid(await renderPageBody(page.id, ctx));
        const layout = typeToLayout(meta.type);
        const fm = buildPageFrontMatter(meta, page.id, layout);
        const content = `${fm}

${body}
`;
        writeRowFile(PAGES_DIR, "_pages/", filename, content, notionIdToFile.get(page.id), existingFiles, stats);
        recordSkipped(report, ctx);
      } catch (err) {
        rowFailure(report, "pages", meta.title, reasonForRowError(err), err);
      }
    }
    const deletion = applyDeletions(PAGES_DIR, "pages", notionIdToFile, processedIds);
    stats.deleted += deletion.deleted;
    report.guard = deletion.guard;
    if (report.guard) {
      console.log(`
   kept as they were: _data/nav.yml, _data/home.yml, _config.yml`);
      console.log(`
   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
      return { ...report, navChanged: false, homeChanged: false, configChanged: false };
    }
    navItems.sort((a, b) => a.order - b.order);
    const navYaml = buildNavYaml(navItems);
    const navPath = path.join(DATA_DIR, "nav.yml");
    const existingNav = fs.existsSync(navPath) ? fs.readFileSync(navPath, "utf8") : "";
    let navChanged = false;
    if (existingNav !== navYaml) {
      fs.writeFileSync(navPath, navYaml, "utf8");
      navChanged = true;
      console.log(`
   updated: _data/nav.yml`);
    } else {
      console.log(`
   unchanged: _data/nav.yml`);
    }
    let homeChanged = false;
    let configChanged = false;
    if (homeData) {
      const homeYaml = buildHomeYaml(homeData);
      const homePath = path.join(DATA_DIR, "home.yml");
      const existingHome = fs.existsSync(homePath) ? fs.readFileSync(homePath, "utf8") : "";
      if (existingHome !== homeYaml) {
        fs.writeFileSync(homePath, homeYaml, "utf8");
        homeChanged = true;
        console.log("   updated: _data/home.yml");
      } else {
        console.log("   unchanged: _data/home.yml");
      }
      configChanged = syncConfigIdentity(homeData.name, homeData.tagline || homeData.description);
    }
    console.log(`
   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
    return { ...report, navChanged, homeChanged, configChanged };
  }
  function rowTitleSafe(page) {
    try {
      return rowTitle(page.properties ?? {});
    } catch {
      return "Untitled";
    }
  }
  function todayDate(now = new Date) {
    return now.toISOString().slice(0, 10);
  }
  function isFutureDate(date, now = new Date) {
    if (!date)
      return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date))
      return date > todayDate(now);
    const at = Date.parse(date);
    return Number.isFinite(at) && at > now.getTime();
  }
  function extractPostMeta(page, existingSlug = "") {
    const props = page.properties;
    const title = rowTitle(props);
    const slug = resolveSlug({
      typed: propText(findProp(props, POST_COLUMNS.slug)),
      title,
      existingSlug,
      pageId: page.id
    });
    const dateProp = findProp(props, POST_COLUMNS.date);
    const date = dateProp?.date?.start ?? (page.created_time ? String(page.created_time).slice(0, 10) : todayDate());
    const tags = (findProp(props, POST_COLUMNS.tags)?.multi_select ?? []).map((t) => t.name);
    const description = propText(findProp(props, POST_COLUMNS.description)).trim();
    const coverFiles = findProp(props, POST_COLUMNS.cover)?.files ?? [];
    const coverImage = coverFiles[0]?.external?.url ?? coverFiles[0]?.file?.url ?? "";
    const canonicalUrl = findProp(props, POST_COLUMNS.canonical)?.url ?? "";
    const featured = findProp(props, POST_COLUMNS.featured)?.checkbox ?? false;
    return { title, slug, date, tags, description, coverImage, canonicalUrl, featured };
  }
  function buildPostFrontMatter(meta, notionId) {
    const lines = ["---"];
    lines.push(`layout: post`);
    lines.push(`title: ${yamlStr(meta.title)}`);
    lines.push(`date: ${meta.date}`);
    lines.push(`slug: ${yamlStr(meta.slug)}`);
    if (meta.tags.length > 0) {
      lines.push(`tags: [${meta.tags.map(yamlStr).join(", ")}]`);
    }
    if (meta.description)
      lines.push(`excerpt: ${yamlStr(meta.description)}`);
    if (meta.coverImage)
      lines.push(`cover_image: ${yamlStr(meta.coverImage)}`);
    if (meta.canonicalUrl)
      lines.push(`canonical_url: ${yamlStr(meta.canonicalUrl)}`);
    if (meta.featured)
      lines.push(`featured: true`);
    lines.push(`notion_id: ${yamlStr(notionId)}`);
    lines.push("---");
    return lines.join(`
`);
  }
  function postFilename(date, slug) {
    return `${String(date).slice(0, 10)}-${slug}.md`;
  }
  function existingPostSlug(file) {
    return readFrontMatter(path.join(POSTS_DIR, file)).slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
  }
  async function syncPosts(assets) {
    console.log(`
\u2500\u2500 Posts sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    console.log(`   Database: ${POSTS_DB_ID}`);
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    const { files: existingFiles, notionIdToFile } = indexByNotionId(POSTS_DIR);
    console.log(`   Existing posts in _posts/: ${existingFiles.length}`);
    let publishedPages;
    try {
      publishedPages = await fetchPublished(POSTS_DB_ID);
    } catch (err) {
      throw new Error(`Error querying posts database: ${err.message}`);
    }
    console.log(`   Published posts in Notion: ${publishedPages.length}
`);
    const processedIds = new Set;
    const report = newReport();
    const { stats } = report;
    const planned = [];
    for (const page of publishedPages) {
      processedIds.add(page.id);
      const prev = notionIdToFile.get(page.id);
      let meta;
      try {
        meta = extractPostMeta(page, prev ? existingPostSlug(prev) : "");
      } catch (err) {
        console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
        rowFailure(report, "posts", rowTitleSafe(page), "unexpected", err);
        continue;
      }
      if (isFutureDate(meta.date)) {
        console.log(`   \u2192 "${meta.title}" waits for ${meta.date}`);
        stats.scheduled++;
        continue;
      }
      planned.push({ page, meta, filename: postFilename(meta.date, meta.slug) });
    }
    const clashes = findAddressClashes(planned, notionIdToFile);
    for (const { page, meta, filename } of planned) {
      console.log(`   \u2192 "${meta.title}"`);
      if (clashes.has(page.id)) {
        rowFailure(report, "posts", meta.title, "duplicate_web_address");
        continue;
      }
      const ctx = rowContext("posts", meta.title, assets);
      try {
        const coverProp = findProp(page.properties, POST_COLUMNS.cover);
        const coverImage = coverProp?.files?.length ? await filesPropertyUrl(coverProp, ctx) : "";
        const body = protectLiquid(await renderPageBody(page.id, ctx));
        const fm = buildPostFrontMatter({ ...meta, coverImage }, page.id);
        const content = `${fm}

${body}
`;
        writeRowFile(POSTS_DIR, "", filename, content, notionIdToFile.get(page.id), existingFiles, stats);
        recordSkipped(report, ctx);
      } catch (err) {
        rowFailure(report, "posts", meta.title, reasonForRowError(err), err);
      }
    }
    const deletion = applyDeletions(POSTS_DIR, "posts", notionIdToFile, processedIds);
    stats.deleted += deletion.deleted;
    report.guard = deletion.guard;
    console.log(`
   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
    return { ...report, navChanged: false, homeChanged: false, configChanged: false };
  }
  function buildActionResult(sections, assets = { downloaded: 0, removed: 0 }) {
    let changed = assets.downloaded > 0 || assets.removed > 0;
    const parts = [];
    for (const { label, stats, navChanged, homeChanged, configChanged } of sections) {
      if (stats.created || stats.updated || stats.renamed || stats.deleted || navChanged || homeChanged || configChanged) {
        changed = true;
      }
      const counts = [
        `${stats.created} created`,
        `${stats.updated} updated`,
        `${stats.renamed} renamed`,
        `${stats.deleted} deleted`,
        `${stats.unchanged} unchanged`
      ];
      if (stats.scheduled)
        counts.push(`${stats.scheduled} scheduled`);
      if (stats.errors)
        counts.push(`${stats.errors} errors`);
      const section = `${label}: ${counts.join(", ")}`;
      const dataFiles = [
        navChanged ? "nav.yml" : null,
        homeChanged ? "home.yml" : null,
        configChanged ? "_config.yml" : null
      ].filter(Boolean);
      parts.push(dataFiles.length ? `${section} (${dataFiles.join(", ")} updated)` : section);
    }
    if (assets.downloaded || assets.removed) {
      parts.push(`files: ${assets.downloaded} downloaded, ${assets.removed} removed`);
    }
    if (sections.length === 0)
      parts.push("no sections synced");
    return { changed, summary: parts.join("; ") };
  }
  var RUN_SUMMARY_SCHEMA_VERSION = 1;
  var SUMMARY_ROWS_MAX = 20;
  var ROW_PROBLEM_TEXT = {
    duplicate_web_address: "Another row already uses the same web address. Give one of them a different Web address.",
    read_failed: "Notion did not hand it over this time. It will be tried again at the next update.",
    unexpected: "Something in it could not be converted. Try removing the most recent change.",
    would_remove: "No longer Published in Notion."
  };
  var FILE_PROBLEM_TEXT = {
    file_too_large: `A file larger than ${MAX_FILE_MB} MB was left out.`,
    file_type_unsupported: "A file of a type websites cannot show was left out.",
    file_unavailable: "A file could not be downloaded from Notion. It will be tried again at the next update.",
    blocks_unsupported: "Some blocks your site cannot show (such as a linked database or a sub-page) were left out."
  };
  function redact(text, secrets = []) {
    let safe = String(text ?? "");
    for (const secret of secrets) {
      if (!secret)
        continue;
      safe = safe.split(secret).join("[redacted]");
    }
    return safe;
  }
  function sectionCounts(sections, label) {
    const section = sections.find((s) => s.label === label);
    return section ? { ...section.stats } : null;
  }
  function dataFilesChanged(sections) {
    return {
      nav: sections.some((s) => s.navChanged),
      home: sections.some((s) => s.homeChanged),
      config: sections.some((s) => s.configChanged)
    };
  }
  function cleanTitle(title) {
    return String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "Untitled";
  }
  function affectedRows(sections) {
    const rows = [];
    for (const section of sections) {
      for (const row of section.failed ?? [])
        rows.push(row);
      for (const title of section.guard?.titles ?? []) {
        rows.push({ section: section.label, title, reason_code: "would_remove" });
      }
    }
    return rows.slice(0, SUMMARY_ROWS_MAX).map((row) => ({
      section: row.section,
      title: cleanTitle(row.title),
      reason_code: row.reason_code,
      reason: ROW_PROBLEM_TEXT[row.reason_code] ?? ROW_PROBLEM_TEXT.unexpected
    }));
  }
  function skippedContent(sections) {
    return sections.flatMap((section) => section.skipped ?? []).slice(0, SUMMARY_ROWS_MAX).map((row) => ({
      section: row.section,
      title: cleanTitle(row.title),
      reason_code: row.reason_code,
      reason: FILE_PROBLEM_TEXT[row.reason_code] ?? FILE_PROBLEM_TEXT.blocks_unsupported,
      count: row.count
    }));
  }
  function buildRunSummary({ result, code, changed, startedAt, finishedAt, sections = [], detail, secrets }) {
    if (!Array.isArray(secrets)) {
      throw new TypeError("buildRunSummary: secrets must be an array (pass [] when none apply yet)");
    }
    const affected = affectedRows(sections);
    const skipped = skippedContent(sections);
    return {
      schema_version: RUN_SUMMARY_SCHEMA_VERSION,
      result,
      code,
      changed,
      started_at: startedAt,
      finished_at: finishedAt,
      pages: sectionCounts(sections, "pages"),
      posts: sectionCounts(sections, "posts"),
      data_files: sections.length === 0 ? null : dataFilesChanged(sections),
      detail: redact(detail, secrets),
      ...affected.length ? { affected } : {},
      ...skipped.length ? { skipped } : {}
    };
  }
  var RESULT_ICON = { success: "\u2705", no_op: "\u23ED\uFE0F", failure: "\u274C" };
  function mdText(text) {
    return String(text).replace(/[\\`*_[\]<>|]/g, "\\$&");
  }
  function renderStepSummaryMarkdown(summary) {
    const lines = [
      `### Notion \u2192 Jekyll sync \u2014 ${RESULT_ICON[summary.result] ?? ""} ${summary.result} (\`${summary.code}\`)`,
      "",
      `- **Changed:** ${summary.changed ? "yes" : "no"}`,
      `- **Started:** ${summary.started_at}`,
      `- **Finished:** ${summary.finished_at}`,
      ""
    ];
    if (summary.pages || summary.posts) {
      lines.push("| Section | Created | Updated | Renamed | Deleted | Unchanged | Errors |");
      lines.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const [label, counts] of [["Pages", summary.pages], ["Posts", summary.posts]]) {
        if (!counts)
          continue;
        lines.push(`| ${label} | ${counts.created} | ${counts.updated} | ${counts.renamed} | ${counts.deleted} | ${counts.unchanged} | ${counts.errors} |`);
      }
      lines.push("");
    }
    if (summary.data_files) {
      const updated = Object.entries({ "nav.yml": summary.data_files.nav, "home.yml": summary.data_files.home, "_config.yml": summary.data_files.config }).filter(([, changed]) => changed).map(([name]) => name);
      lines.push(`**Data files updated:** ${updated.length ? updated.join(", ") : "none"}`);
      lines.push("");
    }
    if (summary.affected?.length) {
      lines.push(summary.code === "bulk_delete_guard" ? "**Kept on the site, waiting for you to confirm:**" : "**Not published this time:**");
      for (const row of summary.affected)
        lines.push(`- ${mdText(row.title)} (${row.section}): ${row.reason}`);
      lines.push("");
    }
    if (summary.skipped?.length) {
      lines.push("**Published, with something left out:**");
      for (const row of summary.skipped)
        lines.push(`- ${mdText(row.title)} (${row.section}): ${row.reason}`);
      lines.push("");
    }
    if (summary.detail)
      lines.push(summary.detail);
    return `${lines.join(`
`)}
`;
  }
  function writeActionOutputs(summary) {
    const json = JSON.stringify(summary);
    const runSummaryPath = process.env.RUN_SUMMARY_FILE;
    if (runSummaryPath) {
      try {
        fs.mkdirSync(path.dirname(runSummaryPath), { recursive: true });
        fs.writeFileSync(runSummaryPath, json + `
`);
      } catch (err) {
        console.warn(`   Warning: could not write the run summary file: ${err.message}`);
      }
    }
    console.log(`
   result: ${summary.result} (${summary.code})`);
    console.log(`   changed: ${summary.changed}`);
    console.log(`   summary: ${json}`);
    const outPath = process.env.GITHUB_OUTPUT;
    if (outPath) {
      fs.appendFileSync(outPath, [
        `changed=${summary.changed}`,
        "summary<<NOTIONGIT_SYNC_SUMMARY_EOF",
        json,
        "NOTIONGIT_SYNC_SUMMARY_EOF",
        ""
      ].join(`
`));
    }
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummaryPath) {
      fs.appendFileSync(stepSummaryPath, renderStepSummaryMarkdown(summary));
    }
  }
  async function run(config) {
    initRun(config);
    console.log(`Notion \u2192 Jekyll sync
`);
    const sections = [];
    const assets = { downloaded: 0, removed: 0 };
    if (PAGES_DB_ID) {
      sections.push({ label: "pages", ...await syncPages(assets) });
    } else {
      console.log("Skipping pages sync (NOTION_PAGES_DATABASE_ID not set).");
    }
    if (POSTS_DB_ID) {
      sections.push({ label: "posts", ...await syncPosts(assets) });
    } else {
      console.log("Skipping posts sync (NOTION_POSTS_DATABASE_ID / NOTION_DATABASE_ID not set).");
    }
    assets.removed = pruneAssets();
    return { sections, assets };
  }
  async function main() {
    const startedAt = new Date().toISOString();
    let config;
    try {
      config = resolveConfig();
    } catch (err) {
      if (!(err instanceof ConfigError))
        throw err;
      console.log(`Notion sync skipped: ${err.message}`);
      console.log("Configure NOTION_TOKEN and at least one of NOTION_PAGES_DATABASE_ID / " + "NOTION_POSTS_DATABASE_ID (repository secrets/variables), then re-run this workflow.");
      writeActionOutputs(buildRunSummary({
        result: "no_op",
        code: "missing_credentials",
        changed: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: `skipped: ${err.message}`,
        secrets: []
      }));
      return;
    }
    const secrets = [config.notionToken, config.pagesDbId, config.postsDbId].filter(Boolean);
    let sections, assets;
    try {
      ({ sections, assets } = await run(config));
    } catch (err) {
      console.error(`
Fatal: ${err.message}`);
      writeActionOutputs(buildRunSummary({
        result: "failure",
        code: "sync_error",
        changed: false,
        startedAt,
        finishedAt: new Date().toISOString(),
        secrets,
        detail: `sync failed: ${err.message}`
      }));
      process.exit(1);
    }
    const totalErrors = sections.reduce((n, s) => n + s.stats.errors, 0);
    const guarded = sections.find((s) => s.guard);
    console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    const { changed, summary: counts } = buildActionResult(sections, assets);
    const guardDetail = guarded ? `bulk-delete guard tripped for ${guarded.guard.label}: would delete ${guarded.guard.staleCount} of ${guarded.guard.trackedCount} tracked (${Math.round(guarded.guard.ratio * 100)}%); ` : "";
    writeActionOutputs(buildRunSummary({
      result: guarded || totalErrors > 0 ? "failure" : "success",
      code: guarded ? "bulk_delete_guard" : totalErrors > 0 ? "row_errors" : "synced",
      changed,
      startedAt,
      finishedAt: new Date().toISOString(),
      sections,
      detail: `${guardDetail}${counts}`,
      secrets
    }));
    if (guarded) {
      console.error("Sync finished, but some deletions were held back. See above for details.");
      process.exit(1);
    }
    if (totalErrors > 0) {
      console.log(`::warning::${totalErrors} row(s) could not be published this time. The rest of the site was updated.`);
      console.log(`Sync finished with ${totalErrors} row error(s). See above for details.`);
      return;
    }
    console.log("Sync complete.");
  }
  if (import.meta.main) {
    main().catch((err) => {
      console.error(`
Fatal: ${err.message}`);
      process.exit(1);
    });
  }
  module.exports = {
    ConfigError,
    isTrue,
    resolveConfig,
    buildActionResult,
    RUN_SUMMARY_SCHEMA_VERSION,
    redact,
    buildRunSummary,
    renderStepSummaryMarkdown,
    writeActionOutputs,
    richTextToMarkdown,
    richTextToPlain,
    blockToMarkdown,
    blocksToMarkdown,
    protectLiquid,
    slugify,
    titleToSlug,
    resolveSlug,
    normalizePageType,
    typeToLayout,
    isFutureDate,
    extractPageMeta,
    extractPostMeta,
    buildPageFrontMatter,
    buildPostFrontMatter,
    postFilename
  };
});
export default require_sync_notion();
