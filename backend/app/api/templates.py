from fastapi import APIRouter, HTTPException, Request
from app.templates.loader import load_stacks, render_flows, summary

router = APIRouter(prefix="/api")


@router.get("/templates")
def list_templates():
    return [summary(s) for s in load_stacks().values()]


@router.get("/templates/{key}")
def get_template(key: str, request: Request):
    """Query parameters named after the stack's placeholders (e.g. ?django_module=mysite) fill them in."""
    stack = load_stacks().get(key)
    if not stack:
        raise HTTPException(404, "template not found")
    flows = render_flows(stack, dict(request.query_params))
    return {**summary(stack), "placeholders": stack.get("placeholders", {}),
            "flows": {k: g.model_dump() for k, g in flows.items()}}
