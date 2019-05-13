#!/usr/bin/env python3

import argparse
import glob
import jsone
import yaml

# todo split service account yaml into three files
# todo: deployment
# todo: cronjob
# todo: make things work no matter cwd and os


def render_service_account(project_name):
    return
    context = {"project_name": project_name}
    template = yaml.load(open("templates/service-account.yaml"), Loader=yaml.SafeLoader)
    print(jsone.render(template, context))


def render_secrets(project_name, secrets):
    context = {"project_name": project_name, "secrets": secrets}
    template = yaml.load(open("templates/secret.yaml"), Loader=yaml.SafeLoader)
    print(jsone.render(template, context))


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
