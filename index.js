import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());

app.post('/identify', async (req, res) => {
  try {
    const { email, phoneNumber } = req.body;

    if (!email && !phoneNumber) {
      return res.status(400).json({ error: 'Email or phoneNumber required' });
    }

    // Find all matching contacts by email or phoneNumber
    let contacts = await prisma.contact.findMany({
      where: {
        OR: [
          ...(email ? [{ email }] : []),
          ...(phoneNumber ? [{ phoneNumber }] : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    // Case 1: No contact found → create a new primary contact
    if (contacts.length === 0) {
      const newContact = await prisma.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkPrecedence: 'primary',
        },
      });

      return res.json({
        contact: {
          primaryContactId: newContact.id,
          emails: email ? [email] : [],
          phoneNumbers: phoneNumber ? [phoneNumber] : [],
          secondaryContactIds: [],
        },
      });
    }

    // Case 2: Existing contacts found
    let primaryContact = contacts.find(c => c.linkPrecedence === 'primary') || contacts[0];

    // Ensure only one primary contact
    const primaryContacts = contacts.filter(c => c.linkPrecedence === 'primary');
    if (primaryContacts.length > 1) {
      const oldestPrimary = primaryContacts[0];
      const others = primaryContacts.slice(1);

      for (const contact of others) {
        await prisma.contact.update({
          where: { id: contact.id },
          data: {
            linkPrecedence: 'secondary',
            linkedId: oldestPrimary.id,
          },
        });
      }

      // Refresh contacts after fixing duplicates
      contacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: oldestPrimary.id },
            { linkedId: oldestPrimary.id },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });

      primaryContact = oldestPrimary;
    }

    // If either email or phoneNumber is new, create a secondary contact
    const isEmailExists = email ? contacts.some(c => c.email === email) : false;
    const isPhoneExists = phoneNumber ? contacts.some(c => c.phoneNumber === phoneNumber) : false;

    if ((email && !isEmailExists) || (phoneNumber && !isPhoneExists)) {
      await prisma.contact.create({
        data: {
          email: email || null,
          phoneNumber: phoneNumber || null,
          linkedId: primaryContact.id,
          linkPrecedence: 'secondary',
        },
      });

      // Refresh contacts again after insertion
      contacts = await prisma.contact.findMany({
        where: {
          OR: [
            { id: primaryContact.id },
            { linkedId: primaryContact.id },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // Prepare final response
    const emails = Array.from(new Set(contacts.map(c => c.email).filter(Boolean)));
    const phoneNumbers = Array.from(new Set(contacts.map(c => c.phoneNumber).filter(Boolean)));
    const secondaryContactIds = contacts
      .filter(c => c.linkPrecedence === 'secondary')
      .map(c => c.id);

    return res.json({
      contact: {
        primaryContactId: primaryContact.id,
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    });
  } catch (error) {
    console.error('Error in /identify:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
