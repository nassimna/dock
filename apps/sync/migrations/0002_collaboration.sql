ALTER TABLE accounts ADD COLUMN recovery_hash TEXT;
ALTER TABLE sessions ADD COLUMN device_name TEXT NOT NULL DEFAULT 'Dock desktop';
CREATE TABLE shared_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id),
  payload TEXT NOT NULL
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES shared_projects(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (project_id, account_id)
);
CREATE INDEX project_members_by_account ON project_members(account_id);
CREATE TABLE account_workspaces (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  mutation_id TEXT NOT NULL
);
CREATE TABLE workspace_mutations (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  mutation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (account_id, mutation_id)
);
