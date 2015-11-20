# -*- coding: utf-8 -*-

from __future__ import print_function, unicode_literals

from escher.version import __version__, __schema_version__, __map_model_version__
import os
import re
from os.path import dirname, realpath, join

root_directory = realpath(join(dirname(__file__), '..'))

_escher_local = {
    'builder_embed_css': 'escher/static/escher/builder-embed.css',
    'builder_css': 'escher/static/escher/builder.css',
    'escher': 'escher/static/escher/escher.js',
    'escher_min': 'escher/static/escher/escher.min.js',
    'logo': 'escher/static/img/escher-logo@2x.png',
    'favicon': 'escher/static/img/favicon.ico',
    'index_js': 'escher/static/homepage/index.js',
    'index_gh_pages_js': 'escher/static/homepage/index_gh_pages.js',
    'index_css': 'escher/static/homepage/index.css',
    'server_index': '%s/%s/index.json' % (__schema_version__, __map_model_version__),
    'map_download': '%s/%s/maps/' % (__schema_version__, __map_model_version__),
    'model_download': '%s/%s/models/' % (__schema_version__, __map_model_version__),
}

_escher_web = {
    'builder_embed_css': 'builder-embed-%s.css' % __version__,
    'builder_css': 'builder-%s.css' % __version__,
    'escher': 'escher-%s.js' % __version__,
    'escher_min': 'escher-%s.min.js' % __version__,
    'server_index': '%s/%s/index.json' % (__schema_version__, __map_model_version__),
    'map_download': '%s/%s/maps/' % (__schema_version__, __map_model_version__),
    'model_download': '%s/%s/models/' % (__schema_version__, __map_model_version__),
    'favicon': 'escher/static/img/favicon.ico',
}

_dependencies = {
    'd3': 'escher/static/lib/d3-3.5.9.min.js',
    'boot_js': 'escher/static/lib/bootstrap-3.1.1.min.js',
    'boot_css': 'escher/static/lib/bootstrap-simplex-3.1.1.min.css',
    'jquery': 'escher/static/lib/jquery-2.1.4.min.js',
    'require_js': 'escher/static/lib/require-2.1.21.min.js',
}

_dependencies_cdn = {
    'd3': '//cdnjs.cloudflare.com/ajax/libs/d3/3.5.9/d3.min.js',
    'boot_js': '//netdna.bootstrapcdn.com/bootstrap/3.1.1/js/bootstrap.min.js',
    'boot_css': '//netdna.bootstrapcdn.com/bootswatch/3.1.1/simplex/bootstrap.min.css',
    'jquery': '//cdnjs.cloudflare.com/ajax/libs/jquery/2.1.4/jquery.min.js',
    'require_js': '//cdnjs.cloudflare.com/ajax/libs/require.js/2.1.21/require.min.js',
}

_links = {
    'escher_root': '//escher.github.io/',
    'github': '//github.com/zakandrewking/escher/',
    'github_releases': '//github.com/zakandrewking/escher/releases',
    'documentation': '//escher.readthedocs.org/',
}

# external dependencies
names = list(_escher_local.keys()) + list(_escher_web.keys()) + list(_dependencies.keys()) + list(_links.keys())

def get_url(name, source='web', local_host=None, protocol=None):
    """Get a url.

    Arguments
    ---------

    name: The name of the URL. Options are available in urls.names.

    source: Either 'web' or 'local'. Cannot be 'local' for external links.

    protocol: The protocol can be 'http', 'https', or None which indicates a
    'protocol relative URL', as in //escher.github.io. Ignored if source is
    local.

    local_host: A host url, including the protocol. e.g. http://localhost:7778.

    """
    if source not in ['web', 'local']:
        raise Exception('Bad source: %s' % source)

    if protocol not in [None, 'http', 'https']:
        raise Exception('Bad protocol: %s' % protocol)

    if protocol is None:
        protocol = ''
    else:
        protocol = protocol + ':'

    def apply_local_host(url):
        return '/'.join([local_host.rstrip('/'), url.lstrip('/')])

    # escher
    if name in _escher_local and source == 'local':
        if local_host is not None:
            return apply_local_host(_escher_local[name])
        return _escher_local[name]
    elif name in _escher_web and source == 'web':
        return protocol + '/'.join([_links['escher_root'].rstrip('/'),
                                    _escher_web[name].lstrip('/')])
    # links
    elif name in _links:
        if source=='local':
            raise Exception('Source cannot be "local" for external links')
        return protocol + _links[name]
    # local dependencies
    elif name in _dependencies and source=='local':
        if local_host is not None:
            return apply_local_host(_dependencies[name])
        return _dependencies[name]
    # cdn dependencies
    elif name in _dependencies_cdn and source=='web':
        return protocol + _dependencies_cdn[name]

    raise Exception('name not found')
