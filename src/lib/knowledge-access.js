import {readAgentIdentity} from './agent-identity-policy.js';
import { one, rows } from "./db.js";
import { workspacePermissionSet } from "./permissions.js";

const ACCESS_RANK = { none: 0, view: 1, edit: 2, admin: 3 };

function highest(current, candidate) {
  return ACCESS_RANK[candidate] > ACCESS_RANK[current] ? candidate : current;
}

export async function knowledgeAccessMap(user, spaces) {
  if(user.is_service){const identity=await readAgentIdentity(user);return new Map(spaces.map(s=>[Number(s.id),identity.policy.spaces?.find(g=>Number(g.id)===Number(s.id))?.level||"none"]));}
  const permissions = await workspacePermissionSet(user);
  const platformAdmin = permissions.has("knowledge.manage");
  const canViewOpenSpaces = permissions.has("knowledge.view") || platformAdmin;
  if (!spaces.length) return new Map();

  if (platformAdmin || ["owner", "admin"].includes(user.global_role))
    return new Map(spaces.map((space) => [Number(space.id), "admin"]));

  const memberships = await rows(
    `SELECT member.team_id, member.team_role
     FROM knowledge_team_members member
     JOIN knowledge_teams team ON team.id=member.team_id
     WHERE member.user_id=? AND team.workspace_id=? AND team.active=TRUE`,
    [user.id, user.workspace_id],
  );
  const teamIds = memberships.map((item) => Number(item.team_id));
  const grants = await rows(
    `SELECT space_id, principal_type, principal_id, access_level
     FROM knowledge_space_permissions
     WHERE principal_type='user' AND principal_id=?
        ${teamIds.length ? `OR (principal_type='team' AND principal_id IN (${teamIds.map(() => "?").join(",")}))` : ""}`,
    [user.id, ...teamIds],
  );
  const memberByTeam = new Map(
    memberships.map((item) => [Number(item.team_id), item.team_role]),
  );
  const access = new Map();
  for (const space of spaces) {
    let level = "none";
    if (canViewOpenSpaces && ["workspace", "public"].includes(space.visibility))
      level = "view";
    if (Number(space.created_by) === Number(user.id)) level = "admin";
    const ownerRole = memberByTeam.get(Number(space.owner_team_id));
    if (ownerRole === "lead") level = highest(level, "admin");
    else if (ownerRole === "member") level = highest(level, "edit");
    for (const grant of grants)
      if (Number(grant.space_id) === Number(space.id))
        level = highest(level, grant.access_level);
    access.set(Number(space.id), level);
  }
  return access;
}

export async function knowledgeSpaceAccess(user, spaceOrId) {
  const space =
    typeof spaceOrId === "object"
      ? spaceOrId
      : await one(
          "SELECT * FROM knowledge_spaces WHERE id=? AND workspace_id=?",
          [spaceOrId, user.workspace_id],
        );
  if (!space || Number(space.workspace_id) !== Number(user.workspace_id))
    return { space: null, level: "none" };
  const access = await knowledgeAccessMap(user, [space]);
  return { space, level: access.get(Number(space.id)) || "none" };
}

export function knowledgeAccessAtLeast(level, required) {
  return ACCESS_RANK[level] >= ACCESS_RANK[required];
}
