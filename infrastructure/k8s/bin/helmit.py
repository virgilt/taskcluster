#!/usr/bin/env python3

import argparse
import glob
import jsone
import yaml

# todo: deployment
# todo: cronjob
# todo: make things work no matter cwd and os

# secrets are interpolated by json-e into this helm expression
# "{{ secret | b64enc }}"
# to make this work if a literal, quote it
# if a value being interpoloated by helm, leave it alone
def escape_secrets(secrets):
    for key, value in secrets.items():
        if not value.startswith("."):
            secrets[key] = f'"{value}"'


def render_service_account(project_name):
    context = {"project_name": project_name}
    for template in ("role", "role-binding", "service-account"):
        template = yaml.load(open(f"templates/{template}.yaml"), Loader=yaml.SafeLoader)
        print("---")
        print(yaml.dump(jsone.render(template, context)))


def render_secrets(project_name, secrets):
    escape_secrets(secrets)
    context = {"project_name": project_name, "secrets": secrets}
    template = yaml.load(open("templates/secret.yaml"), Loader=yaml.SafeLoader)
    print("---")
    print(yaml.dump(jsone.render(template, context)))


def render_deployment(declaration):
    pass


def render_cronjob(declaration):
    pass


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
    if "secrets" in declaration:
        render_secrets(project_name, declaration["secrets"])
        render_service_account(project_name)
    for deployment in declaration.get("deployments", []):
        render_deployment(deployment)
    for cronjob in declaration.get("cronjobs", []):
        render_cronjob(cronjob)
