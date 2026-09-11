"""Django admin registration for the social app.

Deliberately thin. This is the breadth pass: enough to read the tables, find a
row, and take down a bad review while the custom Admin Dashboard is being
built. Moderation actions, inlines on the recipe page and the reporting views
belong to the depth pass.

Every model here is registered in its own right rather than inlined on the
recipe. Unlike steps and ingredient links, a rating or a review is the thing a
moderator goes looking for - they arrive knowing the comment was reported, not
which recipe it sits under.

No custom forms: ModelForm runs full_clean(), so Rating.clean() already
refuses the rows the API refuses - an author scoring their own recipe included.
"""

from django.contrib import admin

from .models import Comment, Rating, RecipeTag, SavedRecipe, Tag


@admin.register(Rating)
class RatingAdmin(admin.ModelAdmin):
    """Admin for social.Rating."""

    list_display = ('recipe', 'user', 'score', 'created_at')
    list_filter = ('score',)
    search_fields = ('recipe__title', 'user__username')
    ordering = ('-created_at',)

    # The changelist shows the recipe and the rater on every row; without this
    # that is two extra queries per rating.
    list_select_related = ('recipe', 'user')

    # auto_now_add.
    readonly_fields = ('created_at',)


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    """Admin for social.Comment - the moderation surface for reviews.

    Deleting a row here is the "remove an inappropriate review" function from
    CLAUDE.md, done by hand until the dashboard offers it.
    """

    list_display = ('recipe', 'user', 'created_at')
    search_fields = ('recipe__title', 'user__username', 'content')
    ordering = ('-created_at',)
    list_select_related = ('recipe', 'user')
    readonly_fields = ('created_at',)


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    """Admin for the shared tag lookup table.

    The one place a tag name can be corrected: TagViewSet is read-only, so a
    typo that reached the table stays there until someone fixes it here.
    Renaming a row retags every recipe carrying it, which is the point of a
    shared table - and the reason to be careful.

    search_fields is not decoration: it is what lets other admins reference
    tags through autocomplete_fields.
    """

    list_display = ('name', 'recipe_count')
    search_fields = ('name',)
    ordering = ('name',)

    @admin.display(description='Used by', ordering='name')
    def recipe_count(self, tag):
        """How many recipes carry this tag."""
        return tag.recipe_links.count()


@admin.register(RecipeTag)
class RecipeTagAdmin(admin.ModelAdmin):
    """Admin for social.RecipeTag - which tags a recipe carries.

    Standalone rather than an inline on RecipeAdmin, which would mean editing
    recipes/admin.py to add it. Worth doing in the depth pass; not worth the
    cross-app change now.
    """

    list_display = ('recipe', 'tag')
    search_fields = ('recipe__title', 'tag__name')
    ordering = ('-recipe_tag_id',)
    list_select_related = ('recipe', 'tag')


@admin.register(SavedRecipe)
class SavedRecipeAdmin(admin.ModelAdmin):
    """Admin for social.SavedRecipe.

    Read-mostly: a user's collection is theirs, and the reason to look at this
    table from here is to answer "what is being saved" for the dashboard's
    most-saved report.
    """

    list_display = ('user', 'recipe', 'saved_at')
    search_fields = ('user__username', 'recipe__title')
    ordering = ('-saved_at',)
    list_select_related = ('user', 'recipe')
    readonly_fields = ('saved_at',)
