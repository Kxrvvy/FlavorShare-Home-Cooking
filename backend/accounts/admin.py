"""Django admin registration for the User model.

This is the fallback management surface while the custom Admin Dashboard is
being built, so it is worth having even though the project ships its own
admin pages.

Subclasses Django's own UserAdmin rather than a plain ModelAdmin, because
that is what supplies the hashed-password widget and the two-field password
form when adding a user. Every attribute below has to be restated: the stock
UserAdmin refers to first_name, last_name, date_joined and an is_staff
*column*, none of which this model has.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    """Admin for accounts.User."""

    list_display = ('username', 'email', 'role', 'is_active', 'created_at')
    list_filter = ('role', 'is_active', 'is_superuser')
    search_fields = ('username', 'email')
    ordering = ('username',)

    # created_at is auto_now_add and last_login is written by the login flow,
    # so neither may be edited by hand.
    readonly_fields = ('created_at', 'last_login')

    fieldsets = (
        (None, {'fields': ('username', 'password')}),
        ('Profile', {'fields': ('email', 'dietary_preferences')}),
        (
            'Role and access',
            {
                'fields': (
                    'role',
                    'is_active',
                    'is_superuser',
                    'groups',
                    'user_permissions',
                ),
                # is_staff is a property derived from role, not a column, so
                # it cannot appear here - set role to Admin instead.
                'description': (
                    'Admin access follows the role field. Setting role to '
                    'Admin grants both the Admin API permissions and access '
                    'to this site.'
                ),
            },
        ),
        ('Dates', {'fields': ('last_login', 'created_at')}),
    )

    add_fieldsets = (
        (
            None,
            {
                'classes': ('wide',),
                'fields': ('username', 'email', 'role', 'password1', 'password2'),
            },
        ),
    )
