"""Socket-only authentication for the two synthetic authority identities."""
import json


def enable_fixture_logins(rehearsal):
    state = json.loads(rehearsal.command(["docker", "inspect", rehearsal.container]).stdout)[0]
    assert state["HostConfig"]["NetworkMode"] == "none"
    assert not state["HostConfig"]["PortBindings"]
    assert rehearsal.sql("select current_setting('cluster_name')") == "venfour-delivery-rehearsal"
    path = rehearsal.sql("show hba_file")
    assert path == "/etc/postgresql/pg_hba.conf"
    original = rehearsal.command(["docker", "exec", rehearsal.container, "cat", path]).stdout
    rules = "local postgres authority_fixture_publisher,authority_fixture_writer trust\n"
    fixture = rehearsal.output / "fixture-pg-hba.conf"
    fixture.write_text(rules + original)
    rehearsal.command(["docker", "cp", str(fixture), rehearsal.container + ":" + path])
    assert rehearsal.sql("select pg_reload_conf()", role="supabase_admin") == "t"
    for role in ("authority_fixture_publisher", "authority_fixture_writer"):
        assert rehearsal.sql("select session_user", role=role) == role
