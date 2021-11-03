import { PassThrough } from "stream";
import type * as express from "express";
import type {
  AppLoadContext,
  ServerBuild,
  ServerPlatform,
  CreateRequestHandlerOptions
} from "@remix-run/server-runtime";
import { createRequestHandler as createRemixRequestHandler } from "@remix-run/server-runtime";
import type {
  RequestInit as NodeRequestInit,
  Response as NodeResponse
} from "@remix-run/node";
import {
  Headers as NodeHeaders,
  Request as NodeRequest,
  formatServerError
} from "@remix-run/node";

/**
 * A function that returns the value to use as `context` in route `loader` and
 * `action` functions.
 *
 * You can think of this as an escape hatch that allows you to pass
 * environment/platform-specific values through to your loader/action, such as
 * values that are generated by Express middleware like `req.session`.
 */
export interface GetLoadContextFunction {
  (req: express.Request, res: express.Response): AppLoadContext;
}

export type RequestHandler = ReturnType<typeof createRequestHandler>;

/**
 * Returns a request handler for Express that serves the response using Remix.
 */
export function createRequestHandler({
  beforeRequest,
  beforeResponse,
  build,
  getLoadContext,
  mode = process.env.NODE_ENV
}: Omit<CreateRequestHandlerOptions, "platform"> & {
  getLoadContext?: GetLoadContextFunction;
}) {
  let platform: ServerPlatform = { formatServerError };
  let handleRequest = createRemixRequestHandler({
    beforeRequest,
    beforeResponse,
    build,
    platform,
    mode
  });

  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    try {
      let request = createRemixRequest(req);
      let loadContext =
        typeof getLoadContext === "function"
          ? getLoadContext(req, res)
          : undefined;

      let response = (await handleRequest(
        request as unknown as Request,
        loadContext
      )) as unknown as NodeResponse;

      sendRemixResponse(res, response);
    } catch (error) {
      // Express doesn't support async functions, so we have to pass along the
      // error manually using next().
      next(error);
    }
  };
}

export function createRemixHeaders(
  requestHeaders: express.Request["headers"]
): NodeHeaders {
  let headers = new NodeHeaders();

  for (let [key, values] of Object.entries(requestHeaders)) {
    if (values) {
      if (Array.isArray(values)) {
        for (const value of values) {
          headers.append(key, value);
        }
      } else {
        headers.set(key, values);
      }
    }
  }

  return headers;
}

export function createRemixRequest(req: express.Request): NodeRequest {
  let origin = `${req.protocol}://${req.get("host")}`;
  let url = new URL(req.url, origin);

  let init: NodeRequestInit = {
    method: req.method,
    headers: createRemixHeaders(req.headers)
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.pipe(new PassThrough({ highWaterMark: 16384 }));
  }

  return new NodeRequest(url.toString(), init);
}

function sendRemixResponse(
  res: express.Response,
  response: NodeResponse
): void {
  res.status(response.status);

  for (let [key, values] of Object.entries(response.headers.raw())) {
    for (const value of values) {
      res.append(key, value);
    }
  }

  if (Buffer.isBuffer(response.body)) {
    res.end(response.body);
  } else if (response.body?.pipe) {
    response.body.pipe(res);
  } else {
    res.end();
  }
}
