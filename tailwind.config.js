/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
  	extend: {
  		fontFamily: {
  			inter: ['var(--font-inter)']
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  safelist: [
    'bg-blue-500', 'bg-green-500', 'bg-orange-500', 'bg-pink-400', 'bg-yellow-400',
    'text-white', 'text-yellow-900',
    'bg-blue-50', 'bg-green-50', 'bg-orange-50', 'bg-pink-50', 'bg-yellow-50',
    'text-blue-700', 'text-green-700', 'text-orange-700', 'text-pink-700', 'text-yellow-700',
    'border-blue-200', 'border-green-200', 'border-orange-200', 'border-pink-200', 'border-yellow-200',
    'bg-blue-100', 'bg-green-100', 'bg-orange-100', 'bg-pink-100', 'bg-yellow-100', 'bg-amber-100',
    'text-amber-700',
    'bg-purple-100', 'text-purple-700', 'border-purple-200',
    'bg-purple-50', 'text-purple-600',
    'bg-pink-50', 'bg-pink-100', 'text-pink-700', 'border-pink-200',
    'bg-orange-50', 'bg-orange-100', 'text-orange-700', 'border-orange-200',
    'bg-yellow-50', 'bg-yellow-100', 'text-yellow-700', 'border-yellow-200',
    'bg-green-50', 'bg-green-100', 'text-green-700', 'border-green-200',
    'bg-blue-50', 'bg-blue-100', 'text-blue-700', 'border-blue-200',
  ],
  plugins: [require("tailwindcss-animate")],
}