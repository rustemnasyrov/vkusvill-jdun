"""add courier profile fields"""

revision = "003_courier_profile"
down_revision = "002_courier_type"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column("couriers", sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""))
    op.add_column("couriers", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("couriers", sa.Column("courier_type", sa.String(length=16), nullable=False, server_default="teal"))
    op.execute("UPDATE couriers SET full_name = COALESCE(external_ref, ''), phone = external_ref WHERE external_ref IS NOT NULL")
    op.create_unique_constraint("uq_couriers_phone", "couriers", ["phone"])
    op.alter_column("couriers", "full_name", server_default=None)
    op.alter_column("couriers", "courier_type", server_default=None)


def downgrade() -> None:
    op.drop_constraint("uq_couriers_phone", "couriers", type_="unique")
    op.drop_column("couriers", "courier_type")
    op.drop_column("couriers", "phone")
    op.drop_column("couriers", "full_name")
