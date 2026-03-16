export interface Project {
  id: string;
  name: string;
  createdAt: string;
  lastAccessed?: string;
}

/**
 * ProjectManager - handles project CRUD
 */
export class ProjectManager {
  constructor(private db: any) {}

  /**
   * Create a project
   */
  create(name: string): Project {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    
    this.db.run(
      `INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)`,
      [id, name, now]
    );
    
    return { id, name, createdAt: now };
  }

  /**
   * Get project by ID
   */
  get(projectId: string): Project | undefined {
    const row = this.db.get(
      `SELECT * FROM projects WHERE id = ?`,
      [projectId]
    );
    
    if (!row) return undefined;
    return this.mapRowToProject(row);
  }

  /**
   * Get project by name
   */
  getByName(name: string): Project | undefined {
    const row = this.db.get(
      `SELECT * FROM projects WHERE name = ?`,
      [name]
    );
    
    if (!row) return undefined;
    return this.mapRowToProject(row);
  }

  /**
   * List all projects
   */
  list(): Project[] {
    const rows = this.db.query(
      `SELECT * FROM projects ORDER BY last_accessed DESC, created_at DESC`
    );
    
    return rows.map((row: any) => this.mapRowToProject(row));
  }

  /**
   * Update last accessed
   */
  touch(projectId: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE projects SET last_accessed = ? WHERE id = ?`,
      [now, projectId]
    );
  }

  /**
   * Delete project (soft - doesn't cascade)
   */
  delete(projectId: string): boolean {
    const result = this.db.run(
      `DELETE FROM projects WHERE id = ?`,
      [projectId]
    );
    return result.changes > 0;
  }

  /**
   * Get session count for project
   */
  getSessionCount(projectId: string): number {
    const result = this.db.get(
      `SELECT COUNT(*) as count FROM sessions WHERE project_id = ?`,
      [projectId]
    ) as { count: number };
    return result?.count ?? 0;
  }

  private mapRowToProject(row: any): Project {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
    };
  }
}
