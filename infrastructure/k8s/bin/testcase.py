#!/usr/bin/env python

import jsone
import yaml

raw_template = """
apiVersion: v1
kind: Secret
type: Opaque
metadata:
  name: ${project_name}
data:
  $map: {$eval: secrets}
  each(s):
    ${s.key}: {$eval: s.val}
"""

template = yaml.load(raw_template)

context = {'project_name': 'taskcluster-references', 'secrets': {'application_name': 'my-cool-cluster'}}

print(jsone.render(template, context))