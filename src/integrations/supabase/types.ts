export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_level_permissions: {
        Row: {
          access_level: number
          permission_key: string
        }
        Insert: {
          access_level: number
          permission_key: string
        }
        Update: {
          access_level?: number
          permission_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_level_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      access_requests: {
        Row: {
          cancelled_at: string | null
          created_at: string
          current_level: number
          id: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          current_level: number
          id?: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          current_level?: number
          id?: string
          owner_user_id?: string
          reason?: string
          requested_level?: number
          requester_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: []
      }
      corporate_mail_settings: {
        Row: {
          domain: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          domain: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          domain?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      corporate_mailboxes: {
        Row: {
          created_at: string
          created_by: string
          disabled_at: string | null
          domain: string
          email: string
          id: string
          is_primary: boolean
          local_part: string
          metadata: Json | null
          provider: string | null
          provider_user_id: string | null
          status: Database["public"]["Enums"]["corporate_mailbox_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          disabled_at?: string | null
          domain: string
          email: string
          id?: string
          is_primary?: boolean
          local_part: string
          metadata?: Json | null
          provider?: string | null
          provider_user_id?: string | null
          status?: Database["public"]["Enums"]["corporate_mailbox_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          disabled_at?: string | null
          domain?: string
          email?: string
          id?: string
          is_primary?: boolean
          local_part?: string
          metadata?: Json | null
          provider?: string | null
          provider_user_id?: string | null
          status?: Database["public"]["Enums"]["corporate_mailbox_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_credentials: {
        Row: {
          changed_at: string | null
          expires_at: string
          issued_at: string
          issued_by: string | null
          must_change_password: boolean
          user_id: string
        }
        Insert: {
          changed_at?: string | null
          expires_at: string
          issued_at?: string
          issued_by?: string | null
          must_change_password?: boolean
          user_id: string
        }
        Update: {
          changed_at?: string | null
          expires_at?: string
          issued_at?: string
          issued_by?: string | null
          must_change_password?: boolean
          user_id?: string
        }
        Relationships: []
      }
      mailbox_audit_events: {
        Row: {
          action: Database["public"]["Enums"]["mailbox_audit_action"]
          actor_user_id: string | null
          created_at: string
          id: string
          mailbox_id: string | null
          metadata: Json | null
          target_user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["mailbox_audit_action"]
          actor_user_id?: string | null
          created_at?: string
          id?: string
          mailbox_id?: string | null
          metadata?: Json | null
          target_user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["mailbox_audit_action"]
          actor_user_id?: string | null
          created_at?: string
          id?: string
          mailbox_id?: string | null
          metadata?: Json | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailbox_audit_events_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "corporate_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      nexa_owners: {
        Row: {
          granted_at: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          access_request_id: string | null
          body: string | null
          created_at: string
          id: string
          metadata: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          access_request_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          access_request_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_access_request_id_fkey"
            columns: ["access_request_id"]
            isOneToOne: false
            referencedRelation: "access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          key: string
        }
        Insert: {
          description: string
          key: string
        }
        Update: {
          description?: string
          key?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_level: number
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string
          id: string
          invitation_status: string
          is_active: boolean
          is_vip: boolean
          location: string | null
          mailbox_status: string
          phone: string | null
          position: string | null
          presence: string
          updated_at: string
        }
        Insert: {
          access_level?: number
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string
          id: string
          invitation_status?: string
          is_active?: boolean
          is_vip?: boolean
          location?: string | null
          mailbox_status?: string
          phone?: string | null
          position?: string | null
          presence?: string
          updated_at?: string
        }
        Update: {
          access_level?: number
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string
          id?: string
          invitation_status?: string
          is_active?: boolean
          is_vip?: boolean
          location?: string | null
          mailbox_status?: string
          phone?: string | null
          position?: string | null
          presence?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          added_at: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          added_at?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_key: string
          role: string
        }
        Insert: {
          permission_key: string
          role: string
        }
        Update: {
          permission_key?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey"
            columns: ["permission_key"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          parent_comment_id: string | null
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          parent_comment_id?: string | null
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_history: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          field: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          session_id: string | null
          task_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          session_id?: string | null
          task_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          session_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_entries: {
        Row: {
          duration_seconds: number | null
          ended_at: string | null
          id: string
          session_id: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          session_id: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          session_id?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          completion_report: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          estimated_seconds: number
          id: string
          number: number
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          spent_seconds: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          completion_report?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          estimated_seconds?: number
          id?: string
          number?: never
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id: string
          spent_seconds?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          completion_report?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          estimated_seconds?: number
          id?: string
          number?: never
          parent_task_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          project_id?: string
          spent_seconds?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _close_running_entry: { Args: { _task_id: string }; Returns: number }
      _close_running_entry_for_user: {
        Args: { _task_id: string; _user_id: string }
        Returns: number
      }
      can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_edit_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_profile: { Args: { _profile_id: string }; Returns: boolean }
      cancel_access_level_request: {
        Args: { _request_id: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_level: number
          id: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      corporate_mail_domain: { Args: never; Returns: string }
      create_access_level_request: {
        Args: { _reason: string; _requested_level: number }
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_level: number
          id: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_user_is_owner: { Args: never; Returns: boolean }
      ensure_my_profile: {
        Args: { _full_name?: string }
        Returns: {
          access_level: number
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string
          id: string
          invitation_status: string
          is_active: boolean
          is_vip: boolean
          location: string | null
          mailbox_status: string
          phone: string | null
          position: string | null
          presence: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_corporate_mailbox_provisioning: {
        Args: { _mailbox_id: string; _result: string }
        Returns: Json
      }
      get_admin_panel_data: { Args: never; Returns: Json }
      get_employee_credential_states: { Args: never; Returns: Json }
      get_mailbox_reservation_target: {
        Args: { _user_id: string }
        Returns: Json
      }
      get_my_access_level_requests: {
        Args: never
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_level: number
          id: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "access_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_my_credential_state: { Args: never; Returns: Json }
      get_my_nexa_access_flags: { Args: never; Returns: Json }
      get_my_notifications: {
        Args: never
        Returns: {
          access_request_id: string | null
          body: string | null
          created_at: string
          id: string
          metadata: Json
          read_at: string | null
          title: string
          type: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_system_status: { Args: never; Returns: Json }
      has_permission: { Args: { _permission: string }; Returns: boolean }
      has_permission_for: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notifications_read: { Args: { _ids: string[] }; Returns: number }
      recalc_parent_progress: { Args: { _parent: string }; Returns: undefined }
      reserve_corporate_mailbox: {
        Args: { _email: string; _local_part: string; _user_id: string }
        Returns: Json
      }
      review_access_level_request: {
        Args: { _decision: string; _request_id: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          current_level: number
          id: string
          owner_user_id: string
          reason: string
          requested_level: number
          requester_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revoke_user_sessions: { Args: { _user_id: string }; Returns: number }
      suggest_corporate_email: {
        Args: { _for_user?: string; _local_part: string }
        Returns: Json
      }
      task_transition: {
        Args: {
          _action: string
          _report?: string
          _session_id?: string
          _task_id: string
        }
        Returns: {
          assignee_id: string | null
          completed_at: string | null
          completion_report: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          estimated_seconds: number
          id: string
          number: number
          parent_task_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          project_id: string
          spent_seconds: number
          started_at: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_admin_employee: {
        Args: {
          _access_level: number
          _department: string
          _full_name: string
          _is_active: boolean
          _is_vip: boolean
          _location: string
          _phone: string
          _position: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: Json
      }
      update_permission_matrix: {
        Args: {
          _enabled: boolean
          _kind: string
          _permission: string
          _subject: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "employee" | "director"
      corporate_mailbox_status:
        | "pending"
        | "active"
        | "suspended"
        | "disabled"
        | "error"
      mailbox_audit_action:
        | "mailbox_created"
        | "mailbox_disabled"
        | "mailbox_enabled"
        | "mailbox_deleted"
        | "mailbox_provision_failed"
      task_priority: "low" | "medium" | "high" | "critical"
      task_status: "todo" | "in_progress" | "waiting" | "done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "employee", "director"],
      corporate_mailbox_status: [
        "pending",
        "active",
        "suspended",
        "disabled",
        "error",
      ],
      mailbox_audit_action: [
        "mailbox_created",
        "mailbox_disabled",
        "mailbox_enabled",
        "mailbox_deleted",
        "mailbox_provision_failed",
      ],
      task_priority: ["low", "medium", "high", "critical"],
      task_status: ["todo", "in_progress", "waiting", "done"],
    },
  },
} as const
