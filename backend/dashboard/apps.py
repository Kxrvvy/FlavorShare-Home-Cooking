from django.apps import AppConfig


class DashboardConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'dashboard'

    def ready(self):
        """Connect the Activity log's receivers.

        Imported here rather than at module level because ready() is the first
        point Django guarantees every app's models can be imported, and
        signals.py imports from recipes and social.

        The import itself is what connects them - the @receiver decorators run
        on first import. noqa because it is deliberately unused.
        """
        from . import signals  # noqa: F401
