"""HTTP Request node resolver — Phase 7.0.

Registers:
- ``http.request``  outbound HTTP calls with template interpolation and auth
"""

from __future__ import annotations

import sys
from typing import Any

from holon.registry import register_spec_type
from holon.library.template import render_template


@register_spec_type("http.request")
def resolve_http_request(props: dict[str, Any]) -> Any:
    """Resolve an http.request spec node.

    Returns an async callable ``execute(data) -> dict`` that performs the
    configured HTTP request.  ``{{ data.field }}`` placeholders in URL,
    headers, query_params, and body are resolved against the input data.

    Props:
        method (str): HTTP verb.  Default ``"GET"``.
        url (str): Target URL.  Supports ``{{ data.field }}``.
        headers (dict): HTTP headers.  Values support templates.
        query_params (dict): Query string parameters.  Values support templates.
        body (dict | str | None): Request body for POST/PUT/PATCH.
            Supports templates in values.
        body_type (str): ``"json"`` | ``"form"`` | ``"raw"``.  Default ``"json"``.
        auth_type (str): ``"none"`` | ``"api_key"`` | ``"bearer"`` | ``"basic"``.
            Default ``"none"``.
        auth_credential (str): Key name in ``credentials_manager``.
        auth_header (str): Header name for auth.  Default ``"Authorization"``.
        auth_query_param (str): Query param name for API key auth.
            If set, the key is appended as a query param instead of a header.
        response_type (str): ``"json"`` | ``"text"`` | ``"binary"``.
            Default ``"json"``.
        timeout (int): Request timeout in seconds.  Default ``30``.
        retry (int): Number of retry attempts on failure.  Default ``0``.
        ignore_errors (bool): When ``True``, HTTP 4xx/5xx do not raise an
            exception.  Default ``False``.

    Returns:
        Async callable ``execute(data: Any) -> dict`` with keys
        ``{status, headers, data}``.
    """
    method: str = props.get("method", "GET").upper()
    url_tpl: str = props.get("url", "")
    headers_tpl: dict[str, str] = dict(props.get("headers", {}))
    qp_tpl: dict[str, str] = dict(props.get("query_params", {}))
    body_tpl: Any = props.get("body")
    body_type: str = props.get("body_type", "json")
    auth_type: str = props.get("auth_type", "none")
    auth_credential: str = props.get("auth_credential", "")
    auth_header: str = props.get("auth_header", "Authorization")
    auth_query_param: str = props.get("auth_query_param", "")
    response_type: str = props.get("response_type", "json")
    timeout: int = int(props.get("timeout", 30))
    retry_count: int = int(props.get("retry", 0))
    ignore_errors: bool = bool(props.get("ignore_errors", False))

    sys.stderr.write(
        f"[HTTP] Resolver: method={method}, url={url_tpl!r}, "
        f"auth={auth_type}, response={response_type}\n"
    )
    sys.stderr.flush()

    async def execute(data: Any = None) -> dict:
        """Perform the HTTP request."""
        try:
            import aiohttp
        except ImportError as exc:
            raise ImportError(
                "aiohttp is required for http.request nodes. "
                "Install with: pip install aiohttp"
            ) from exc

        from holon.library.credentials import credentials_manager

        ctx = {"data": data if isinstance(data, dict) else {"value": data}}

        # Resolve templates
        url = render_template(url_tpl, ctx)
        headers = {k: render_template(v, ctx) for k, v in headers_tpl.items()}
        query_params = {k: render_template(v, ctx) for k, v in qp_tpl.items()}

        # Auth injection
        if auth_credential:
            api_key = credentials_manager.get_api_key(auth_credential)
            if api_key:
                if auth_type == "bearer":
                    headers[auth_header] = f"Bearer {api_key}"
                elif auth_type == "api_key":
                    if auth_query_param:
                        query_params[auth_query_param] = api_key
                    else:
                        headers[auth_header] = api_key
                elif auth_type == "basic":
                    import base64
                    encoded = base64.b64encode(api_key.encode()).decode()
                    headers[auth_header] = f"Basic {encoded}"
            else:
                sys.stderr.write(
                    f"[HTTP] WARNING: No credential found for '{auth_credential}'\n"
                )
                sys.stderr.flush()

        # Body resolution
        body: Any = None
        if body_tpl is not None and method in ("POST", "PUT", "PATCH"):
            if isinstance(body_tpl, dict):
                body = {
                    k: render_template(str(v), ctx) if isinstance(v, str) else v
                    for k, v in body_tpl.items()
                }
            else:
                body = render_template(str(body_tpl), ctx)

        # Execute with retry
        connector = aiohttp.TCPConnector(limit=10)
        async with aiohttp.ClientSession(connector=connector) as session:
            last_exc: Exception | None = None
            for attempt in range(retry_count + 1):
                try:
                    req_kwargs: dict[str, Any] = {
                        "url": url,
                        "headers": headers,
                        "params": query_params,
                        "timeout": aiohttp.ClientTimeout(total=timeout),
                    }
                    if body is not None:
                        if body_type == "json":
                            req_kwargs["json"] = body
                        elif body_type == "form":
                            req_kwargs["data"] = body
                        else:
                            req_kwargs["data"] = body

                    sys.stderr.write(
                        f"[HTTP] {method} {url} "
                        f"(attempt {attempt + 1}/{retry_count + 1})\n"
                    )
                    sys.stderr.flush()

                    async with session.request(method, **req_kwargs) as resp:
                        if not ignore_errors:
                            resp.raise_for_status()

                        if response_type == "json":
                            try:
                                response_data = await resp.json(content_type=None)
                            except Exception:
                                response_data = await resp.text()
                        elif response_type == "text":
                            response_data = await resp.text()
                        else:
                            response_data = await resp.read()

                        sys.stderr.write(
                            f"[HTTP] Response: status={resp.status}, "
                            f"type={type(response_data).__name__}\n"
                        )
                        sys.stderr.flush()

                        return {
                            "status": resp.status,
                            "headers": dict(resp.headers),
                            "data": response_data,
                        }

                except Exception as exc:
                    last_exc = exc
                    if attempt < retry_count:
                        sys.stderr.write(
                            f"[HTTP] Attempt {attempt + 1} failed: {exc}. Retrying…\n"
                        )
                        sys.stderr.flush()
                        import asyncio
                        await asyncio.sleep(1.0 * (attempt + 1))  # back-off

            raise last_exc  # type: ignore[misc]

    execute.__holon_timeout__ = timeout  # type: ignore[attr-defined]
    return execute
