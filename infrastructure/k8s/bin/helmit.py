#!/usr/bin/env python3

import argparse
import glob
import jsone
import yaml

# todo: make helm consitentlyCamelCase
# todo: decide on file structure to output
# todo: add secret hash calculation to deployment
# todo: make things work no matter cwd and os

# secrets are interpolated by json-e into this goland template expression
# "{{ secret | b64enc }}"
# to make this work if a literal, quote it
# if a value being interpoloated by helm, leave it alone
def format_secrets(secrets):
    for key, value in secrets.items():
        if not value.startswith("."):
            secrets[key] = f'"{value}"'


# since non-secrets aren't interpolated into existing template expression
# need to turn them into that
def format_values(context):
    for key, value in context.items():
        if isinstance(value, str) and value.startswith("."):
            context[key] = "{{ " + value + " }}"


def render_rbac(project_name):
    context = {"project_name": project_name}
    for template in ("role", "role-binding", "service-account"):
        template = yaml.load(open(f"templates/{template}.yaml"), Loader=yaml.SafeLoader)
        print("---")
        print(yaml.dump(jsone.render(template, context)))


def render_secrets(project_name, secrets):
    format_secrets(secrets)
    context = {"project_name": project_name, "secrets": secrets}
    template = yaml.load(open("templates/secret.yaml"), Loader=yaml.SafeLoader)
    print("---")
    print(yaml.dump(jsone.render(template, context)))


def render_deployment(project_name, secret_keys, deployment):
    context = {
        "project_name": project_name,
        "secret_keys": secret_keys,
        # below are default values
        "volume_mounts": [],
        "readiness_path": "/",
        "proc_name": False,
        "cpu": "50m",
        "memory": "100Mi",
        "replicas": "1",
        "background_job": False,
        "is_monoimage": True,
    }
    context.update(deployment)
    format_values(context)
    template = yaml.load(open("templates/deployment.yaml"), Loader=yaml.SafeLoader)
    print("---")
    print(yaml.dump(jsone.render(template, context)))


def render_cronjob(project_name, secret_keys, deployment):
    context = {
        "project_name": project_name,
        "secret_keys": secret_keys,
        # below are default values
        "volume_mounts": [],
        "is_monoimage": True,
    }
    context.update(deployment)
    format_values(context)
    template = yaml.load(open("templates/cron-job.yaml"), Loader=yaml.SafeLoader)
    print("---")
    print(yaml.dump(jsone.render(template, context)))


parser = argparse.ArgumentParser()
parser.add_argument("--service", help="Name of the service to render", default=None)
args = parser.parse_args()

if args.service:
    service_declarations = [f"services/{args.service}.yaml"]
else:
    service_declarations = glob.glob("services/*yaml")

for p in service_declarations:
    declaration = yaml.load(open(p), Loader=yaml.SafeLoader)
    project_name = declaration["project_name"]
    secret_keys = list(declaration["secrets"].keys())

    render_secrets(project_name, declaration["secrets"])
    render_rbac(project_name)
    for deployment in declaration.get("deployments", []):
        render_deployment(project_name, secret_keys, deployment)
    for cronjob in declaration.get("cronjobs", []):
        render_cronjob(project_name, secret_keys, cronjob)
