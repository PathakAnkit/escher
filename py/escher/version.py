import json
from os.path import join, dirname

def get_full_version(main_version, post_version=None):
    """Generate a PEP440 compliant version with an optional post-release."""
    if post_version is None:
        return main_version
    else:
        return '%s.post%s' % (main_version, post_version)

with open(join(dirname(__file__), 'package.json'), 'r') as f:
    package = json.load(f)

# software version
__version__ = package['version']
# Escher schema and map version. The schema version determines the version of
# the map specification, and the map version is an additional level so that maps
# can be released with the same spec but new layouts.
__schema_version__ = package['schema_version']
__map_model_version__ = package['map_model_version']

# post-release version (required by PyPI & PEP440)
__post_version__ = None
# full version with post-release
__full_version__ = get_full_version(__version__, __post_version__)
