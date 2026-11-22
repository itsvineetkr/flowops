from app.generators.base import Generator, register


class _ComingSoon(Generator):
    available = False

    def generate(self, graph):
        raise NotImplementedError(f"{self.label} support is coming soon")


class GitLabCI(_ComingSoon):
    key, label = "gitlab", "GitLab CI"


class Jenkins(_ComingSoon):
    key, label = "jenkins", "Jenkins"


register(GitLabCI())
register(Jenkins())
