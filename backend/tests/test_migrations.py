from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.db import Base
from app.migrate import upgrade
from app.models import models  # noqa: F401


def test_migrations_match_models(tmp_path):
    url = f"sqlite:///{tmp_path}/m.db"
    upgrade(url)
    engine = create_engine(url)
    assert {"users", "projects", "flows", "alembic_version"} <= set(inspect(engine).get_table_names())
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], f"models changed without a migration: {diff}  (run: alembic revision --autogenerate)"


def test_account_migration_converts_existing_users(tmp_path):
    from alembic import command
    from sqlalchemy import text

    from app.migrate import alembic_config

    url = f"sqlite:///{tmp_path}/old.db"
    command.upgrade(alembic_config(url), "1e3d12b44a38")  # schema before email accounts
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, github_id, login, avatar_url, github_token_enc, github_refresh_enc) "
                          "VALUES (1, 555, 'octocat', '', 'x', ''), (2, 0, 'dev', '', '', '')"))
    upgrade(url)
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, github_id, github_login, email FROM users ORDER BY id")).all()
    assert rows == [(1, 555, "octocat", None), (2, None, "", "dev@localhost")]
