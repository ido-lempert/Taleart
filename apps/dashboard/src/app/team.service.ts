import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddProjectMemberRequest,
  PendingInvitation,
  ProjectAuditLog,
  ProjectMember,
  UpdateProjectMemberRequest,
} from '@taleart/contract/core';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './dashboard.store';

const projectUrl = (projectId: string) => `${API_BASE}/projects/${encodeURIComponent(projectId)}`;

/** The calls behind Settings > Team. Each returns the API's answer or throws the HttpErrorResponse. */
@Injectable({ providedIn: 'root' })
export class TeamApi {
  private readonly http = inject(HttpClient);

  members(projectId: string): Promise<ProjectMember[]> {
    return firstValueFrom(this.http.get<ProjectMember[]>(`${projectUrl(projectId)}/members`));
  }

  addMember(projectId: string, body: AddProjectMemberRequest): Promise<ProjectMember> {
    return firstValueFrom(this.http.post<ProjectMember>(`${projectUrl(projectId)}/members`, body));
  }

  updateMember(projectId: string, userId: string, body: UpdateProjectMemberRequest): Promise<ProjectMember> {
    return firstValueFrom(
      this.http.patch<ProjectMember>(`${projectUrl(projectId)}/members/${encodeURIComponent(userId)}`, body),
    );
  }

  removeMember(projectId: string, userId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${projectUrl(projectId)}/members/${encodeURIComponent(userId)}`));
  }

  invitations(projectId: string): Promise<PendingInvitation[]> {
    return firstValueFrom(this.http.get<PendingInvitation[]>(`${projectUrl(projectId)}/invitations`));
  }

  revokeInvitation(projectId: string, invitationId: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`${projectUrl(projectId)}/invitations/${encodeURIComponent(invitationId)}`),
    );
  }

  auditLog(projectId: string, before?: string): Promise<ProjectAuditLog> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return firstValueFrom(this.http.get<ProjectAuditLog>(`${projectUrl(projectId)}/audit-log${query}`));
  }
}
