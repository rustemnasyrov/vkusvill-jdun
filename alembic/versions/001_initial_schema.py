"""initial schema with exclusion constraint"""

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_locations"),
    )

    op.create_table(
        "couriers",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("external_ref", sa.String(length=128), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_couriers"),
        sa.UniqueConstraint("external_ref", name="uq_couriers_external_ref"),
    )

    op.create_table(
        "courier_locations",
        sa.Column("courier_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["courier_id"], ["couriers.id"], name="fk_courier_locations_courier_id_couriers", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], name="fk_courier_locations_location_id_locations", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("courier_id", "location_id", name="pk_courier_locations"),
    )

    op.create_table(
        "shift_templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day_of_week", sa.SmallInteger(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], name="fk_shift_templates_location_id_locations", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_shift_templates"),
    )

    op.create_table(
        "shift_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("template_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("capacity", sa.Integer(), nullable=False),
        sa.Column("booked_count", sa.Integer(), nullable=False),
        sa.Column("closed_by_admin", sa.Boolean(), nullable=False),
        sa.Column("booking_opens_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("booking_closes_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], name="fk_shift_instances_location_id_locations", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["template_id"], ["shift_templates.id"], name="fk_shift_instances_template_id_shift_templates", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_shift_instances"),
    )

    op.create_table(
        "assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("courier_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("shift_instance_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["courier_id"], ["couriers.id"], name="fk_assignments_courier_id_couriers", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["shift_instance_id"], ["shift_instances.id"], name="fk_assignments_shift_instance_id_shift_instances", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_assignments"),
        sa.UniqueConstraint("idempotency_key", name="uq_assignments_idempotency_key"),
    )

    op.create_index(
        "ix_uq_assignments_courier_shift_confirmed",
        "assignments",
        ["courier_id", "shift_instance_id"],
        unique=True,
        postgresql_where=sa.text("status = 'confirmed'"),
    )

    op.execute(
        """
        ALTER TABLE assignments ADD CONSTRAINT assignments_no_time_overlap
        EXCLUDE USING gist (
            courier_id WITH =,
            tstzrange(starts_at, ends_at, '[)') WITH &&
        )
        WHERE (status = 'confirmed')
        """
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_type", sa.String(length=32), nullable=False),
        sa.Column("actor_id", sa.String(length=128), nullable=True),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
    )


def downgrade() -> None:
    op.drop_table("audit_logs")
    op.execute("ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_no_time_overlap")
    op.drop_index("ix_uq_assignments_courier_shift_confirmed", table_name="assignments")
    op.drop_table("assignments")
    op.drop_table("shift_instances")
    op.drop_table("shift_templates")
    op.drop_table("courier_locations")
    op.drop_table("couriers")
    op.drop_table("locations")
