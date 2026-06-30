export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          address: string | null;
          company: string | null;
          converted_at: string;
          created_at: string;
          email: string;
          id: string;
          lead_id: string | null;
          name: string | null;
          owner_id: string;
          phone: string | null;
          status: Database["public"]["Enums"]["customer_status"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          company?: string | null;
          converted_at?: string;
          created_at?: string;
          email: string;
          id?: string;
          lead_id?: string | null;
          name?: string | null;
          owner_id: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["customer_status"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          company?: string | null;
          converted_at?: string;
          created_at?: string;
          email?: string;
          id?: string;
          lead_id?: string | null;
          name?: string | null;
          owner_id?: string;
          phone?: string | null;
          status?: Database["public"]["Enums"]["customer_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      email_accounts: {
        Row: {
          connection_api_key: string;
          created_at: string;
          email_address: string;
          history_id: string | null;
          id: string;
          last_sync_at: string | null;
          provider: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connection_api_key: string;
          created_at?: string;
          email_address: string;
          history_id?: string | null;
          id?: string;
          last_sync_at?: string | null;
          provider?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connection_api_key?: string;
          created_at?: string;
          email_address?: string;
          history_id?: string | null;
          id?: string;
          last_sync_at?: string | null;
          provider?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      email_templates: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          is_shared: boolean;
          name: string;
          subject: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          is_shared?: boolean;
          name: string;
          subject: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          is_shared?: boolean;
          name?: string;
          subject?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      emails: {
        Row: {
          account_id: string;
          body_html: string | null;
          body_text: string | null;
          cc_emails: string[];
          created_at: string;
          customer_id: string | null;
          from_email: string;
          from_name: string | null;
          gmail_message_id: string;
          gmail_thread_id: string | null;
          has_replied: boolean;
          id: string;
          is_archived: boolean;
          is_draft: boolean;
          is_read: boolean;
          is_sent: boolean;
          is_spam: boolean;
          is_starred: boolean;
          is_trashed: boolean;
          label_ids: string[];
          labels: string[];
          last_synced_at: string;
          lead_id: string | null;
          received_at: string;
          replied_at: string | null;
          sent_at: string | null;
          snippet: string | null;
          subject: string | null;
          to_emails: string[];
          user_id: string;
        };
        Insert: {
          account_id: string;
          body_html?: string | null;
          body_text?: string | null;
          cc_emails?: string[];
          created_at?: string;
          customer_id?: string | null;
          from_email: string;
          from_name?: string | null;
          gmail_message_id: string;
          gmail_thread_id?: string | null;
          has_replied?: boolean;
          id?: string;
          is_archived?: boolean;
          is_draft?: boolean;
          is_read?: boolean;
          is_sent?: boolean;
          is_spam?: boolean;
          is_starred?: boolean;
          is_trashed?: boolean;
          label_ids?: string[];
          labels?: string[];
          last_synced_at?: string;
          lead_id?: string | null;
          received_at?: string;
          replied_at?: string | null;
          sent_at?: string | null;
          snippet?: string | null;
          subject?: string | null;
          to_emails?: string[];
          user_id: string;
        };
        Update: {
          account_id?: string;
          body_html?: string | null;
          body_text?: string | null;
          cc_emails?: string[];
          created_at?: string;
          customer_id?: string | null;
          from_email?: string;
          from_name?: string | null;
          gmail_message_id?: string;
          gmail_thread_id?: string | null;
          has_replied?: boolean;
          id?: string;
          is_archived?: boolean;
          is_draft?: boolean;
          is_read?: boolean;
          is_sent?: boolean;
          is_spam?: boolean;
          is_starred?: boolean;
          is_trashed?: boolean;
          label_ids?: string[];
          labels?: string[];
          last_synced_at?: string;
          lead_id?: string | null;
          received_at?: string;
          replied_at?: string | null;
          sent_at?: string | null;
          snippet?: string | null;
          subject?: string | null;
          to_emails?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emails_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "email_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emails_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emails_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          company: string | null;
          created_at: string;
          created_by: string | null;
          email: string;
          id: string;
          last_contact_at: string | null;
          name: string | null;
          owner_id: string;
          phone: string | null;
          source: string | null;
          status: Database["public"]["Enums"]["lead_status"];
          updated_at: string;
        };
        Insert: {
          company?: string | null;
          created_at?: string;
          created_by?: string | null;
          email: string;
          id?: string;
          last_contact_at?: string | null;
          name?: string | null;
          owner_id: string;
          phone?: string | null;
          source?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
        };
        Update: {
          company?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string;
          id?: string;
          last_contact_at?: string | null;
          name?: string | null;
          owner_id?: string;
          phone?: string | null;
          source?: string | null;
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          customer_id: string | null;
          id: string;
          lead_id: string | null;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          lead_id?: string | null;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          lead_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notes_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      reminders: {
        Row: {
          completed_at: string | null;
          created_at: string;
          customer_id: string | null;
          due_at: string;
          id: string;
          lead_id: string | null;
          notes: string | null;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          customer_id?: string | null;
          due_at: string;
          id?: string;
          lead_id?: string | null;
          notes?: string | null;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          customer_id?: string | null;
          due_at?: string;
          id?: string;
          lead_id?: string | null;
          notes?: string | null;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reminders_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      get_gmail_folder_counts: {
        Args: {
          p_account_id?: string | null;
        };
        Returns: {
          all_mail: number;
          unread: number;
          read: number;
          starred: number;
          replied: number;
          sent: number;
          drafts: number;
          archived: number;
          spam: number;
          trash: number;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "staff";
      customer_status: "active" | "lost";
      lead_status: "new" | "contacted" | "follow_up" | "won" | "lost";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
      customer_status: ["active", "lost"],
      lead_status: ["new", "contacted", "follow_up", "won", "lost"],
    },
  },
} as const;
