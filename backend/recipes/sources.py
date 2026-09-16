"""Where a recipe came from, and who owns the ones nobody here wrote.

`Recipe.source` is an empty string for everything a person typed into the
builder, and a key from this module for anything an import command pulled in.
The vocabulary lives here rather than as bare strings scattered through the
importer, the serializers and the admin, so renaming a provider is one edit.

The service account exists for a blunt schema reason: `Recipe.user` is a
required FK and `Image.uploaded_by` is too, so an imported meal has to belong to
somebody. It doubles as the credit line - the homepage hero already renders
"By {username}", so an imported recipe says where it came from with no
frontend change.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password

# Recipe.source values. '' is reserved for recipes written here, so a provider
# key must never be empty - the unique constraint treats '' as "hand-written"
# and would stop counting imports as distinct.
THEMEALDB = 'themealdb'

# How a provider is named to a reader, for the credit on a recipe page. The key
# is what the column stores; the label is what a person sees.
SOURCE_LABELS = {
    THEMEALDB: 'TheMealDB',
}

# Addresses under .invalid can never resolve - RFC 2606 reserves the TLD for
# exactly this. Nobody can receive mail there, so nobody can complete a password
# reset for a service account, no matter who finds the username.
SERVICE_EMAILS = {
    THEMEALDB: 'themealdb@flavorshare.invalid',
}


def source_label(source):
    """The reader-facing name for a source, or the raw key if unknown."""
    return SOURCE_LABELS.get(source, source)


def service_account(source=THEMEALDB):
    """The account that owns recipes imported from `source`.

    Get-or-create, so the import command can call it on every run.

    Created lazily here rather than in a data migration on purpose. Migrations
    run when the test database is built, and `dashboard.tests` and
    `accounts.tests` both assert exact user counts against the users their own
    setUpTestData creates - a migration-created account would add one to every
    such count and break tests that have nothing to do with importing.

    Three properties matter, and all three are security rather than tidiness:

    - **No usable password**, so no credential exists to guess or leak. This
      account owns the whole imported catalogue and `Recipe.user` is PROTECT,
      so it cannot be deleted to clean up after a compromise.
    - **The ordinary Registered role**, never Admin. It needs to own rows, not
      to moderate anything.
    - **An unreachable email**, so the forgot-password flow cannot be used to
      turn the account into one somebody can sign in as.

    An account that already exists is returned untouched. If someone has since
    given it a real password through the admin, that was a deliberate act and
    this is not the place to silently undo it - the import command reports it
    instead.
    """
    User = get_user_model()

    user, _ = User.objects.get_or_create(
        username=source,
        defaults={
            'email': SERVICE_EMAILS.get(source, f'{source}@flavorshare.invalid'),
            'role': User.Role.REGISTERED,
            # make_password(None) returns the unusable-password marker, so the
            # row is written already unusable. Creating it and then calling
            # set_password would leave a window where the column held '' and
            # would cost a second write.
            'password': make_password(None),
        },
    )

    return user
