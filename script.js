const form = document.getElementById('reservationForm');

form.addEventListener('submit', function (event) {
  event.preventDefault();

  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const date = document.getElementById('date').value;
  const time = document.getElementById('time').value;
  const guests = document.getElementById('guests').value;
  const table = document.getElementById('table').value;

  if (!name || !phone || !date || !time || !guests || !table) {
    alert('يرجى تعبئة جميع الحقول أولاً.');
    return;
  }

  const message = `تم إرسال طلب حجز جديد:\nالاسم: ${name}\nالهاتف: ${phone}\nالتاريخ: ${date}\nالوقت: ${time}\nعدد الأشخاص: ${guests}\nنوع الطاولة: ${table}`;

  alert(message);
  form.reset();
});
