"""add courier type to shifts"""

revision = "002_courier_type"
down_revision = "001_initial"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    op.add_column(
        "shift_templates",
        sa.Column("courier_type", sa.String(length=16), nullable=False, server_default="teal"),
    )
    op.add_column(
        "shift_instances",
        sa.Column("courier_type", sa.String(length=16), nullable=False, server_default="teal"),
    )
    op.alter_column("shift_templates", "courier_type", server_default=None)
    op.alter_column("shift_instances", "courier_type", server_default=None)


def downgrade() -> None:
    op.drop_column("shift_instances", "courier_type")
    op.drop_column("shift_templates", "courier_type")
