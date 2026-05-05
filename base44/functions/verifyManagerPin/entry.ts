import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Verifies a manager's 4-digit PIN for production run approval.
 * 
 * Payload: { member_id: string, pin: string }
 * Returns: { success: boolean, manager_name?: string, error?: string }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { member_id, pin } = await req.json();

    if (!member_id || !pin) {
      return Response.json({ success: false, error: 'Member ID and PIN are required' });
    }

    if (!/^\d{4}$/.test(pin)) {
      return Response.json({ success: false, error: 'PIN must be exactly 4 digits' });
    }

    // Fetch the team member using service role (ensures we can always read)
    const members = await base44.asServiceRole.entities.TeamMember.filter({ id: member_id });
    const member = members[0];

    if (!member) {
      return Response.json({ success: false, error: 'Team member not found' });
    }

    if (!member.is_manager) {
      return Response.json({ success: false, error: `${member.name} is not authorised as a manager` });
    }

    if (!member.manager_pin) {
      return Response.json({ success: false, error: `${member.name} has no PIN set. Ask an admin to set a PIN in Settings.` });
    }

    if (member.manager_pin !== pin) {
      return Response.json({ success: false, error: 'Incorrect PIN' });
    }

    return Response.json({ 
      success: true, 
      manager_name: member.name,
      member_id: member.id
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});