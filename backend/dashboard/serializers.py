"""Serializers for dashboard read models: aggregate counts and recent activity.

These are typically plain Serializers over computed data rather than
ModelSerializers, since the dashboard reads across other apps.
"""

from rest_framework import serializers

# class DashboardSummarySerializer(serializers.Serializer):
#     recipe_count = serializers.IntegerField()
#     follower_count = serializers.IntegerField()
